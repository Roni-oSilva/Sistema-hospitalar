import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateUserInput, UpdateUserInput } from '@hospital/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { AccessLogService } from '../auth/access-log.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { Actor } from '../auth/auth.types';
import { conflict, notFound, unprocessable } from '../common/errors/app-error';

const USER_INCLUDE = { roles: { include: { role: true } }, sector: true } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly accessLog: AccessLogService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Nunca devolve hash de senha nem dados de sessão. */
  private dto(u: UserRow) {
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      professionalRegister: u.professionalRegister,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      sector: u.sector ? { id: u.sector.id, code: u.sector.code, name: u.sector.name } : null,
      roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
      createdAt: u.createdAt.toISOString(),
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({ include: USER_INCLUDE, orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] });
    return users.map((u) => this.dto(u));
  }

  private async resolveRoles(codes: string[]) {
    const roles = await this.prisma.role.findMany({ where: { code: { in: codes } } });
    if (roles.length !== new Set(codes).size) throw unprocessable('Perfil inválido.', 'INVALID_ROLE');
    return roles;
  }

  async create(actor: Actor, input: CreateUserInput) {
    const roles = await this.resolveRoles(input.roleCodes);
    if (input.temporaryPassword.toLowerCase().includes(input.username)) throw unprocessable('A senha não pode conter o nome de usuário.', 'WEAK_PASSWORD');
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      const user = await this.prisma.run(async (tx) => {
        const u = await tx.user.create({
          data: {
            username: input.username,
            fullName: input.fullName,
            email: input.email ?? null,
            professionalRegister: input.professionalRegister ?? null,
            sectorId: input.sectorId ?? null,
            passwordHash,
            mustChangePassword: true,
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
          include: USER_INCLUDE,
        });
        await this.audit.record(tx, actor, { action: 'USER_CREATED', entityType: 'User', entityId: u.id, metadata: { username: u.username, roles: input.roleCodes } });
        return u;
      });
      return this.dto(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um usuário com este login ou e-mail.', 'USER_EXISTS');
      throw e;
    }
  }

  async update(actor: Actor, id: string, input: UpdateUserInput) {
    const before = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!before) throw notFound('Usuário não encontrado.');
    const roles = await this.resolveRoles(input.roleCodes);
    // proteção contra se trancar fora do sistema
    if (id === actor.userId && !input.isActive) throw unprocessable('Você não pode desativar o seu próprio usuário.', 'SELF_LOCKOUT');
    if (id === actor.userId && !input.roleCodes.includes('ADMINISTRADOR') && before.roles.some((r) => r.role.code === 'ADMINISTRADOR')) {
      throw unprocessable('Você não pode remover o seu próprio perfil de administrador.', 'SELF_LOCKOUT');
    }
    try {
      const after = await this.prisma.run(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: id } });
        const u = await tx.user.update({
          where: { id },
          data: {
            fullName: input.fullName,
            email: input.email ?? null,
            professionalRegister: input.professionalRegister ?? null,
            sectorId: input.sectorId ?? null,
            isActive: input.isActive,
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
          include: USER_INCLUDE,
        });
        const changes = this.audit.diff(
          { fullName: before.fullName, email: before.email, professionalRegister: before.professionalRegister, sector: before.sector?.code ?? null, isActive: before.isActive, roles: before.roles.map((r) => r.role.code).sort().join(',') },
          { fullName: u.fullName, email: u.email, professionalRegister: u.professionalRegister, sector: u.sector?.code ?? null, isActive: u.isActive, roles: u.roles.map((r) => r.role.code).sort().join(',') },
        );
        await this.audit.record(tx, actor, { action: input.isActive ? 'USER_UPDATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: id, ...(changes ? { changes } : {}) });
        return u;
      });
      if (!input.isActive) {
        await this.sessions.revokeAllForUser(id, 'user_deactivated');
        this.realtime.disconnectUser(id);
      }
      return this.dto(after);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um usuário com este e-mail.', 'USER_EXISTS');
      throw e;
    }
  }

  /** Redefine com senha TEMPORÁRIA (troca obrigatória), desbloqueia e encerra as sessões do usuário. */
  async resetPassword(actor: Actor, id: string, temporaryPassword: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw notFound('Usuário não encontrado.');
    if (temporaryPassword.toLowerCase().includes(u.username)) throw unprocessable('A senha não pode conter o nome de usuário.', 'WEAK_PASSWORD');
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.prisma.run(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date() } });
      await this.audit.record(tx, actor, { action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id });
    });
    await this.sessions.revokeAllForUser(id, 'password_reset');
    this.realtime.disconnectUser(id);
    await this.accessLog.record({ event: 'PASSWORD_RESET', success: true, userId: id, usernameAttempted: u.username, reason: `by:${actor.username}`, ip: actor.ip, userAgent: actor.userAgent });
  }

  async revokeSessions(actor: Actor, id: string) {
    const n = await this.sessions.revokeAllForUser(id, 'revoked_by_admin');
    this.realtime.disconnectUser(id);
    await this.audit.record(this.prisma, actor, { action: 'USER_SESSIONS_REVOKED', entityType: 'User', entityId: id, metadata: { sessions: n } });
    return { revoked: n };
  }
}
