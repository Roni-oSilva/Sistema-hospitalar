import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditQuery, PERMISSIONS, PermissionCode } from '@hospital/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { conflict, notFound, unprocessable } from '../common/errors/app-error';

/** Permissões que o perfil ADMINISTRADOR nunca pode perder (evita trancar todos fora da administração). */
const ADMIN_LOCKED: PermissionCode[] = [PERMISSIONS.USERS_WRITE, PERMISSIONS.ROLES_WRITE, PERMISSIONS.USERS_READ, PERMISSIONS.ROLES_READ];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── perfis e permissões ─────────────

  async roles() {
    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] }),
    ]);
    return {
      roles: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        users: r._count.users,
        permissions: r.permissions.map((p) => p.permission.code).sort(),
      })),
      permissions: permissions.map((p) => ({ code: p.code, module: p.module, description: p.description })),
    };
  }

  async updateRolePermissions(actor: Actor, roleCode: string, codes: string[]) {
    const role = await this.prisma.role.findUnique({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound('Perfil não encontrado.');
    if (role.code === 'ADMINISTRADOR' && ADMIN_LOCKED.some((p) => !codes.includes(p))) {
      throw unprocessable('O perfil Administrador precisa manter as permissões de gestão de usuários e perfis.', 'ADMIN_LOCKOUT');
    }
    const perms = await this.prisma.permission.findMany({ where: { code: { in: codes } } });
    const before = role.permissions.map((p) => p.permission.code).sort();
    const after = perms.map((p) => p.code).sort();
    await this.prisma.run(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
      await this.audit.record(tx, actor, {
        action: 'ROLE_PERMISSIONS_UPDATED',
        entityType: 'Role',
        entityId: role.code,
        changes: { fields: ['permissions'], diff: { added: { from: null, to: after.filter((p) => !before.includes(p)) }, removed: { from: before.filter((p) => !after.includes(p)), to: null } } },
      });
    });
    return (await this.roles()).roles.find((r) => r.code === roleCode);
  }

  // ───────────── setores e consultórios ─────────────

  async sectors() {
    return this.prisma.sector.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { rooms: true, users: true } } } });
  }

  async updateSector(actor: Actor, id: string, input: { name: string; isActive: boolean }) {
    const before = await this.prisma.sector.findUnique({ where: { id } });
    if (!before) throw notFound('Setor não encontrado.');
    const s = await this.prisma.sector.update({ where: { id }, data: input });
    const changes = this.audit.diff({ name: before.name, isActive: before.isActive }, { name: s.name, isActive: s.isActive });
    await this.audit.record(this.prisma, actor, { action: 'SECTOR_UPDATED', entityType: 'Sector', entityId: id, ...(changes ? { changes } : {}) });
    return s;
  }

  async rooms(onlyActive = false) {
    const rooms = await this.prisma.room.findMany({
      where: onlyActive ? { isActive: true } : {},
      include: {
        sector: { select: { id: true, name: true } },
        queue: { where: { status: { in: ['CALLED', 'IN_SERVICE'] }, kind: 'MEDICA' }, include: { assignedUser: { select: { fullName: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      sector: r.sector,
      occupiedBy: r.queue[0]?.assignedUser?.fullName ?? null,
    }));
  }

  async createRoom(actor: Actor, input: { name: string; sectorId: string; isActive: boolean }) {
    try {
      const r = await this.prisma.room.create({ data: input });
      await this.audit.record(this.prisma, actor, { action: 'ROOM_CREATED', entityType: 'Room', entityId: r.id, metadata: { name: r.name } });
      return r;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um consultório com este nome.', 'ROOM_EXISTS');
      throw e;
    }
  }

  async updateRoom(actor: Actor, id: string, input: { name?: string; sectorId?: string; isActive?: boolean }) {
    const before = await this.prisma.room.findUnique({ where: { id } });
    if (!before) throw notFound('Consultório não encontrado.');
    if (input.isActive === false) {
      const busy = await this.prisma.queueEntry.count({ where: { roomId: id, kind: 'MEDICA', status: { in: ['CALLED', 'IN_SERVICE'] } } });
      if (busy) throw conflict('O consultório está com um paciente em atendimento. Desative-o depois.', 'ROOM_BUSY');
    }
    try {
      const r = await this.prisma.room.update({ where: { id }, data: input });
      const changes = this.audit.diff({ name: before.name, sectorId: before.sectorId, isActive: before.isActive }, { name: r.name, sectorId: r.sectorId, isActive: r.isActive });
      await this.audit.record(this.prisma, actor, { action: 'ROOM_UPDATED', entityType: 'Room', entityId: id, ...(changes ? { changes } : {}) });
      return r;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um consultório com este nome.', 'ROOM_EXISTS');
      throw e;
    }
  }

  // ───────────── auditoria ─────────────

  async auditLogs(actor: Actor, q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.username ? { username: { contains: q.username.toLowerCase() } } : {}),
      ...(q.action ? { action: { contains: q.action.toUpperCase() } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.attendanceCode ? { attendanceCode: q.attendanceCode.toUpperCase() } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    // consultar a auditoria também é auditado
    await this.audit.record(this.prisma, actor, { action: 'AUDIT_LOG_VIEWED', entityType: 'AuditLog', metadata: { filters: Object.keys(q).filter((k) => (q as Record<string, unknown>)[k] !== undefined && !['page', 'pageSize'].includes(k)) } });
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id.toString(),
        createdAt: r.createdAt.toISOString(),
        username: r.username,
        sector: r.sectorCode,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        attendanceCode: r.attendanceCode,
        patientId: r.patientId,
        changes: r.changes,
        metadata: r.metadata,
        ip: r.ip,
        userAgent: r.userAgent,
      })),
    };
  }

  async accessLogs(q: { event?: string; username?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const where: Prisma.AccessLogWhereInput = {
      ...(q.event ? { event: q.event as Prisma.AccessLogWhereInput['event'] } : {}),
      ...(q.username ? { usernameAttempted: { contains: q.username.toLowerCase() } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.accessLog.count({ where }),
      this.prisma.accessLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ id: r.id.toString(), createdAt: r.createdAt.toISOString(), event: r.event, success: r.success, username: r.usernameAttempted, reason: r.reason, ip: r.ip, userAgent: r.userAgent })),
    };
  }
}
