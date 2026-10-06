import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@hospital/shared';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AppLogger } from '../common/logger/app-logger';
import { AuditService } from '../audit/audit.service';
import { forbidden, unauthorized } from '../common/errors/app-error';
import {
  ALLOW_PENDING_PASSWORD,
  AUTH_ONLY,
  IS_PUBLIC,
  NO_TOUCH,
  PERMISSIONS_META,
} from './auth.decorators';
import { AuthService } from './auth.service';
import type { Actor } from './auth.types';
import { SessionFailure, SessionService } from './session.service';

const FAILURE_MESSAGES: Record<SessionFailure, string> = {
  missing: 'Sessão inválida ou expirada. Entre novamente.',
  invalid: 'Sessão inválida ou expirada. Entre novamente.',
  revoked: 'Sessão encerrada. Entre novamente.',
  expired: 'Sua sessão expirou. Entre novamente.',
  idle: 'Sua sessão expirou por inatividade. Entre novamente.',
  inactive_user: 'Acesso desativado. Procure o administrador.',
};

export type AuthedRequest = Request & {
  id?: string;
  actor: Actor;
  sessionMeta: { idleExpiresAt: Date; absoluteExpiresAt: Date };
};

/**
 * Guard global: AUTENTICAÇÃO + AUTORIZAÇÃO. Negar por padrão — todo endpoint precisa declarar
 * @Public(), @AuthenticatedOnly() ou @RequirePermissions()/@RequireAnyPermission().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string): T | undefined => this.reflector.getAllAndOverride<T>(key, targets);

    if (meta<boolean>(IS_PUBLIC)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.config.cookieName];
    const result = await this.sessions.validate(token, { touch: !meta<boolean>(NO_TOUCH) });
    if (!result.ok) throw unauthorized(FAILURE_MESSAGES[result.reason], result.reason === 'idle' ? 'SESSION_IDLE' : 'UNAUTHENTICATED');

    const actor: Actor = {
      ...result.value.actorBase,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      requestId: req.id ?? null,
    };
    req.actor = actor;
    req.sessionMeta = { idleExpiresAt: result.value.idleExpiresAt, absoluteExpiresAt: result.value.absoluteExpiresAt };

    if (actor.mustChangePassword && !meta<boolean>(ALLOW_PENDING_PASSWORD)) throw AuthService.passwordChangeRequired();

    const required = meta<{ all?: PermissionCode[]; any?: PermissionCode[] }>(PERMISSIONS_META);
    if (required) {
      const okAll = required.all ? required.all.every((p) => actor.permissions.has(p)) : true;
      const okAny = required.any ? required.any.some((p) => actor.permissions.has(p)) : true;
      if (!(okAll && okAny)) {
        // tentativa negada também é rastreável (quem, onde, o que tentou)
        await this.audit.recordSafe(actor, {
          action: 'ACCESS_DENIED',
          entityType: 'Endpoint',
          metadata: { method: req.method, path: req.path, required: required.all ?? required.any },
        });
        throw forbidden();
      }
      return true;
    }

    if (meta<boolean>(AUTH_ONLY)) return true;

    // endpoint sem declaração de segurança: recusa e avisa no log (falha de programação)
    this.logger.error('Endpoint sem declaração de segurança — acesso negado por padrão', { method: req.method, path: req.path });
    throw forbidden();
  }
}
