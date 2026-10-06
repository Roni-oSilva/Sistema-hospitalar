import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AccessLogService } from './access-log.service';
import { PasswordService } from './password.service';
import { SessionService, ValidatedSession } from './session.service';
import type { Actor } from './auth.types';
import { AppError, ErrorCodes, unauthorized, unprocessable } from '../common/errors/app-error';

const GENERIC_LOGIN_ERROR = 'Usuário ou senha inválidos, ou acesso temporariamente bloqueado.';

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly accessLog: AccessLogService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Login. Mensagem de erro IDÊNTICA para usuário inexistente, senha errada, conta inativa e conta bloqueada
   * (não revela quais usuários existem) e tempo equalizado com um hash descartável.
   */
  async login(username: string, password: string, ctx: ClientContext): Promise<{ token: string; expiresAt: Date; user: ValidatedSession['actorBase']; mustChangePassword: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const now = new Date();

    if (!user) {
      await this.passwords.verifyDummy(password);
      await this.accessLog.record({ event: 'LOGIN_FAILED', success: false, usernameAttempted: username, reason: 'unknown_user', ip: ctx.ip, userAgent: ctx.userAgent });
      throw unauthorized(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await this.passwords.verifyDummy(password);
      await this.accessLog.record({ event: 'LOGIN_BLOCKED', success: false, userId: user.id, usernameAttempted: username, reason: 'locked', ip: ctx.ip, userAgent: ctx.userAgent });
      throw unauthorized(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid || !user.isActive) {
      const reason = !user.isActive ? 'inactive_user' : 'bad_password';
      if (!user.isActive) {
        await this.accessLog.record({ event: 'LOGIN_FAILED', success: false, userId: user.id, usernameAttempted: username, reason, ip: ctx.ip, userAgent: ctx.userAgent });
      } else {
        const attempts = user.failedLoginAttempts + 1;
        const lock = attempts >= this.config.login.maxAttempts;
        await this.prisma.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginAttempts: 0, lockedUntil: new Date(now.getTime() + this.config.login.lockMinutes * 60_000) }
            : { failedLoginAttempts: attempts },
        });
        await this.accessLog.record({
          event: lock ? 'LOGIN_BLOCKED' : 'LOGIN_FAILED',
          success: false,
          userId: user.id,
          usernameAttempted: username,
          reason: lock ? 'locked_after_failures' : reason,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      throw unauthorized(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
    }

    const rehash = this.passwords.needsRehash(user.passwordHash) ? await this.passwords.hash(password) : null;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, ...(rehash ? { passwordHash: rehash } : {}) },
    });

    const { token, expiresAt } = await this.sessions.create(user.id, ctx);
    const validated = await this.sessions.validate(token, { touch: false });
    if (!validated.ok) throw new AppError(500, 'INTERNAL_ERROR', 'Não foi possível concluir a operação. Tente novamente.');
    await this.accessLog.record({ event: 'LOGIN_SUCCESS', success: true, userId: user.id, usernameAttempted: username, ip: ctx.ip, userAgent: ctx.userAgent });
    return { token, expiresAt, user: validated.value.actorBase, mustChangePassword: user.mustChangePassword };
  }

  async logout(actor: Actor): Promise<void> {
    await this.sessions.revoke(actor.sessionId, 'logout');
    await this.accessLog.record({ event: 'LOGOUT', success: true, userId: actor.userId, usernameAttempted: actor.username, ip: actor.ip, userAgent: actor.userAgent });
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw unprocessable('A senha atual está incorreta.', 'WRONG_CURRENT_PASSWORD');
    if (newPassword.toLowerCase().includes(user.username)) {
      throw unprocessable('A nova senha não pode conter o nome de usuário.', 'WEAK_PASSWORD');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.run(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
      });
      await this.audit.record(tx, actor, { action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });
    });
    // encerra as demais sessões (se a senha vazou, o invasor perde o acesso)
    await this.sessions.revokeAllForUser(user.id, 'password_changed', actor.sessionId);
    await this.accessLog.record({ event: 'PASSWORD_CHANGED', success: true, userId: user.id, usernameAttempted: user.username, ip: actor.ip, userAgent: actor.userAgent });
  }

  async sessionInfo(actor: Actor, idleExpiresAt: Date, absoluteExpiresAt: Date) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: { sector: true, roles: { include: { role: true } } },
    });
    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        professionalRegister: user.professionalRegister,
        sector: user.sector ? { code: user.sector.code, name: user.sector.name } : null,
        roles: user.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
        permissions: [...actor.permissions].sort(),
        mustChangePassword: user.mustChangePassword,
      },
      session: {
        idleExpiresAt: idleExpiresAt.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        idleMinutes: await this.settings.get('session.idle_minutes'),
      },
    };
  }

  static readonly passwordChangeRequired = () =>
    new AppError(403, ErrorCodes.PASSWORD_CHANGE_REQUIRED, 'Você precisa trocar a senha temporária antes de continuar.');
}
