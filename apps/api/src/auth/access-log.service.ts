import { Injectable } from '@nestjs/common';
import type { AccessEvent } from '@hospital/shared';
import { PrismaService } from '../common/prisma/prisma.service';

export interface AccessLogInput {
  event: AccessEvent;
  success: boolean;
  userId?: string | null;
  usernameAttempted?: string | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const trunc = (s: string | null | undefined, n: number): string | null => (s ? s.slice(0, n) : null);

/** Logs de acesso (login/logout/falhas/bloqueios), separados da auditoria de ações. */
@Injectable()
export class AccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AccessLogInput): Promise<void> {
    try {
      await this.prisma.accessLog.create({
        data: {
          event: input.event,
          success: input.success,
          userId: input.userId ?? null,
          // limita o tamanho: o usuário pode digitar qualquer coisa (inclusive uma senha no campo errado)
          usernameAttempted: trunc(input.usernameAttempted, 60),
          reason: trunc(input.reason, 120),
          ip: trunc(input.ip, 64),
          userAgent: trunc(input.userAgent, 255),
        },
      });
    } catch {
      /* falha de log de acesso não pode impedir o login/logout; o erro de banco já é registrado pelo logger */
    }
  }
}
