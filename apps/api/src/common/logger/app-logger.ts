import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/env';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/** Chaves cujo valor nunca é escrito nos logs. */
const REDACT_KEYS = /pass(word)?|token|secret|authorization|cookie|cpf|cns|\brg\b|hash/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

/**
 * Logger estruturado (uma linha JSON por evento). Regras: nunca registrar corpo de requisição, senhas, tokens,
 * documentos ou conteúdo clínico — apenas ids, rota, status e tempos.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly min: number;
  private readonly pretty: boolean;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.min = LEVELS[config.logLevel];
    this.pretty = config.appEnv === 'development';
    if (config.appEnv === 'test') this.min = LEVELS.error + 1;
  }

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    if (LEVELS[level] < this.min) return;
    const msg = typeof message === 'string' ? message : JSON.stringify(redact(message));
    if (this.pretty) {
      const tail = extra ? ` ${JSON.stringify(redact(extra))}` : '';
      const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${context ? `[${context}] ` : ''}${msg}${tail}`;
      (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
      return;
    }
    const entry = { time: new Date().toISOString(), level, context, msg, ...(extra ? (redact(extra) as object) : {}) };
    (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(entry)}\n`);
  }

  log(message: unknown, context?: string): void { this.write('info', message, context); }
  info(message: unknown, extra?: Record<string, unknown>, context?: string): void { this.write('info', message, context, extra); }
  debug(message: unknown, context?: string): void { this.write('debug', message, context); }
  verbose(message: unknown, context?: string): void { this.write('debug', message, context); }
  warn(message: unknown, extra?: Record<string, unknown> | string): void {
    if (typeof extra === 'string') this.write('warn', message, extra);
    else this.write('warn', message, undefined, extra);
  }
  /** Erros técnicos: stack vai para o log; nunca para a resposta HTTP. */
  error(message: unknown, stackOrExtra?: unknown, context?: string): void {
    const extra: Record<string, unknown> = {};
    if (typeof stackOrExtra === 'string') extra.stack = stackOrExtra;
    else if (stackOrExtra && typeof stackOrExtra === 'object') Object.assign(extra, stackOrExtra);
    this.write('error', message, context, extra);
  }
}
