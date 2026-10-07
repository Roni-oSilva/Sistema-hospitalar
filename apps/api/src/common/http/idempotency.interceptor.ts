import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { defer, from, mergeMap, Observable, of, tap } from 'rxjs';
import type { AuthedRequest } from '../../auth/auth.guard';
import { unprocessable } from '../errors/app-error';

/** Por quanto tempo uma gravação confirmada é lembrada para devolver a mesma resposta a um reenvio. */
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9._-]{8,100}$/;

type Outcome = { ok: true; result: unknown } | { ok: false };
interface Entry {
  fingerprint: string;
  expiresAt: number;
  done: boolean;
  result?: unknown;
  pending?: Promise<Outcome>;
}

/**
 * Gravações idempotentes. Numa rede instável a resposta pode se perder DEPOIS de o servidor gravar; o navegador
 * então reenvia a mesma gravação com o mesmo cabeçalho `Idempotency-Key` e recebe a resposta original, em vez de
 * duplicar sinais vitais, diagnóstico ou item de prescrição.
 *
 * - vale para POST/PUT/DELETE autenticados que enviam a chave (o front envia em toda gravação, menos /auth);
 * - a chave é por usuário; reutilizá-la com outro conteúdo é recusado;
 * - um reenvio que chega enquanto a primeira tentativa ainda processa espera por ela;
 * - gravação que falhou não é lembrada (nada foi gravado: a transação foi desfeita), então o reenvio executa de novo.
 * A memória é do processo: o projeto roda uma instância da API (ver DEPLOY.md, "Escalar").
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly entries = new Map<string, Entry>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const key = req.header('idempotency-key');
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next.handle();
    // login/logout mexem no cookie da resposta: nunca são "repetidos" a partir da memória
    if (!key || !req.actor || !KEY_PATTERN.test(key) || req.originalUrl.split('?')[0].startsWith('/api/auth/')) return next.handle();

    this.purge();
    const id = `${req.actor.userId}:${key}`;
    const fingerprint = createHash('sha256')
      .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
      .digest('hex');
    const existing = this.entries.get(id);
    if (!existing) return this.execute(id, fingerprint, next);

    if (existing.fingerprint !== fingerprint) {
      throw unprocessable('Esta chave de envio já foi usada em outra operação.', 'IDEMPOTENCY_KEY_REUSED');
    }
    const res = context.switchToHttp().getResponse<Response>();
    if (existing.done) {
      res.setHeader('Idempotent-Replay', 'true');
      return of(existing.result);
    }
    // a primeira tentativa ainda está gravando: espera e devolve o mesmo resultado (ou executa, se ela falhou)
    return from(existing.pending ?? Promise.resolve<Outcome>({ ok: false })).pipe(
      mergeMap((outcome) => {
        if (outcome.ok) {
          res.setHeader('Idempotent-Replay', 'true');
          return of(outcome.result);
        }
        return defer(() => this.execute(id, fingerprint, next));
      }),
    );
  }

  private execute(id: string, fingerprint: string, next: CallHandler): Observable<unknown> {
    let settle!: (o: Outcome) => void;
    const pending = new Promise<Outcome>((resolve) => (settle = resolve));
    this.entries.set(id, { fingerprint, expiresAt: Date.now() + TTL_MS, done: false, pending });
    let emitted = false;
    return next.handle().pipe(
      tap({
        next: (result) => {
          emitted = true;
          this.remember(id, { fingerprint, expiresAt: Date.now() + TTL_MS, done: true, result });
          settle({ ok: true, result });
        },
        error: () => {
          this.entries.delete(id);
          settle({ ok: false });
        },
        complete: () => {
          if (emitted) return;
          // handler sem valor de retorno (204): também conta como concluído
          this.remember(id, { fingerprint, expiresAt: Date.now() + TTL_MS, done: true, result: undefined });
          settle({ ok: true, result: undefined });
        },
      }),
    );
  }

  /** Regrava no fim do mapa, para o mapa continuar em ordem de vencimento. */
  private remember(id: string, entry: Entry): void {
    this.entries.delete(id);
    this.entries.set(id, entry);
  }

  /** Remove o que venceu (e o excesso, se passar do limite). O mapa está em ordem de vencimento. */
  private purge(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      const expired = entry.expiresAt <= now;
      if (!expired && this.entries.size <= MAX_ENTRIES) break;
      if (!expired && !entry.done) break; // nunca descarta uma gravação em andamento
      this.entries.delete(id);
    }
  }
}
