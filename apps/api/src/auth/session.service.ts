import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PermissionCode } from '@hospital/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AccessLogService } from './access-log.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { Actor } from './auth.types';

/** Renovar `last_activity_at` no máximo a cada 30 s (evita um UPDATE por requisição). */
const TOUCH_INTERVAL_MS = 30_000;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type SessionFailure = 'missing' | 'invalid' | 'revoked' | 'expired' | 'idle' | 'inactive_user';

export interface ValidatedSession {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  actorBase: Omit<Actor, 'ip' | 'userAgent' | 'requestId'>;
}

/**
 * Sessões opacas no servidor (não JWT): revogação imediata, expiração por inatividade e absoluta,
 * e o cookie só carrega um token aleatório — o banco guarda apenas o SHA-256 dele.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly accessLog: AccessLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, ctx: { ip: string | null; userAgent: string | null }): Promise<{ token: string; expiresAt: Date }> {
    const absoluteHours = await this.settings.get('session.absolute_hours');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + absoluteHours * 3_600_000);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ip: ctx.ip?.slice(0, 64) ?? null,
        userAgent: ctx.userAgent?.slice(0, 255) ?? null,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Valida o token do cookie. `touch=false` consulta sem renovar a inatividade
   * (usado pelo contador de sessão do frontend e pelo WebSocket, que não contam como atividade humana).
   */
  async validate(token: string | undefined, opts: { touch: boolean } = { touch: true }): Promise<{ ok: true; value: ValidatedSession } | { ok: false; reason: SessionFailure }> {
    if (!token || token.length < 20 || token.length > 200) return { ok: false, reason: 'missing' };
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: {
            sector: true,
            roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          },
        },
      },
    });
    if (!session) return { ok: false, reason: 'invalid' };
    if (session.revokedAt) return { ok: false, reason: 'revoked' };

    const now = Date.now();
    const idleMinutes = await this.settings.get('session.idle_minutes');
    const idleExpiresAt = new Date(session.lastActivityAt.getTime() + idleMinutes * 60_000);

    if (session.expiresAt.getTime() <= now) {
      await this.expire(session.id, session.userId, 'absolute');
      return { ok: false, reason: 'expired' };
    }
    if (idleExpiresAt.getTime() <= now) {
      await this.expire(session.id, session.userId, 'idle');
      return { ok: false, reason: 'idle' };
    }
    if (!session.user.isActive) {
      await this.prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'user_inactive' } });
      return { ok: false, reason: 'inactive_user' };
    }

    let newIdleExpiry = idleExpiresAt;
    if (opts.touch && now - session.lastActivityAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: new Date(now) } });
      newIdleExpiry = new Date(now + idleMinutes * 60_000);
    }

    const permissions = new Set<PermissionCode>();
    for (const ur of session.user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code as PermissionCode);

    return {
      ok: true,
      value: {
        sessionId: session.id,
        idleExpiresAt: newIdleExpiry,
        absoluteExpiresAt: session.expiresAt,
        actorBase: {
          userId: session.user.id,
          username: session.user.username,
          fullName: session.user.fullName,
          professionalRegister: session.user.professionalRegister,
          sectorId: session.user.sectorId,
          sectorCode: session.user.sector?.code ?? null,
          roles: session.user.roles.map((r) => r.role.code),
          permissions,
          mustChangePassword: session.user.mustChangePassword,
          sessionId: session.id,
        },
      },
    };
  }

  private async expire(sessionId: string, userId: string, kind: 'idle' | 'absolute'): Promise<void> {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: kind === 'idle' ? 'idle_timeout' : 'absolute_timeout' },
    });
    if (res.count > 0) await this.accessLog.record({ event: 'SESSION_EXPIRED', success: false, userId, reason: kind });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }

  /** Higiene: remove sessões encerradas há mais de 30 dias. */
  async purgeOld(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const res = await this.prisma.session.deleteMany({ where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] } });
    return res.count;
  }
}
