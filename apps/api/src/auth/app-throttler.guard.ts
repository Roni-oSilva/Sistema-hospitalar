import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Chave do rate limit: a SESSÃO quando existe (vários funcionários atrás do mesmo IP/NAT do hospital não
 * dividem a mesma cota) e o IP para requisições anônimas (login, painel público).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const token = cookies['__Host-hosp_session'] ?? cookies['hosp_session'];
    if (token) return `s:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
    return `ip:${String(req.ip ?? 'unknown')}`;
  }
}
