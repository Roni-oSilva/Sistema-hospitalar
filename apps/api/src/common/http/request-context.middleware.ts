import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { AppLogger } from '../logger/app-logger';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Marca de cliente legítimo. Navegadores não conseguem enviar este cabeçalho em requisições cross-site sem preflight. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'hospital-web';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('Cache-Control', 'no-store'); // respostas podem conter dados de saúde: nada de cache em proxy/navegador

    // Proteção CSRF (além de SameSite=Lax): em métodos que alteram estado, exige Origin permitida
    // E o cabeçalho de cliente legítimo. Origin ausente (clientes não-navegador) só passa com o cabeçalho.
    if (UNSAFE.has(req.method)) {
      const origin = req.header('origin');
      const okOrigin = origin ? this.config.webOrigins.includes(origin.replace(/\/$/, '')) : true;
      const okHeader = req.header(CSRF_HEADER) === CSRF_VALUE;
      if (!okOrigin || !okHeader) {
        this.logger.warn('Requisição bloqueada pela verificação CSRF', { requestId: req.id, method: req.method, path: req.path, origin });
        // resposta direta: este middleware roda antes do roteamento do Nest (fora do filtro global)
        res.status(403).json({ code: 'CSRF_BLOCKED', message: 'Requisição não autorizada.', requestId: req.id });
        return;
      }
    }

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Somente metadados: nunca corpo, query string ou cabeçalhos (podem conter dados pessoais).
      this.logger.info('http', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(ms),
      }, 'HTTP');
    });
    next();
  }
}
