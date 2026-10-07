/**
 * Cliente HTTP da API. Regras:
 *  - mesma origem (/api), cookie httpOnly de sessão enviado automaticamente;
 *  - cabeçalho anti-CSRF exigido pela API em toda requisição que altera estado;
 *  - o funcionário NUNCA vê erro técnico: a API já devolve mensagens seguras; falhas de rede viram texto claro.
 */

import { noteServerDate } from './clock';
import { reportOffline, reportOnline } from './connectivity';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
    public readonly details: Record<string, unknown> = {},
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Listener = () => void;
const activityListeners = new Set<Listener>();
const unauthorizedListeners = new Set<(code: string) => void>();

/** Toda chamada bem-sucedida conta como atividade (o servidor renova a sessão). */
export function onApiActivity(fn: Listener): () => void {
  activityListeners.add(fn);
  return () => activityListeners.delete(fn);
}
export function onUnauthorized(fn: (code: string) => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** não dispara redirecionamento para o login em 401 (telas de login/senha) */
  silentAuth?: boolean;
  signal?: AbortSignal;
}

/** Consultas desistem em 20 s; gravações em 25 s (o Nginx corta em 30 s). */
const TIMEOUT_MS = { read: 20_000, write: 25_000 } as const;
/** Gravação que falhou por rede é reenviada sozinha (mesma chave) enquanto couber nesta janela. */
const WRITE_RETRY_WINDOW_MS = 15_000;
const WRITE_RETRY_DELAYS_MS = [1_500, 4_000];
const GATEWAY_STATUSES = new Set([502, 503, 504]);

const MESSAGES = {
  readNetwork: 'Sem conexão com o servidor. Verifique a rede e tente novamente.',
  readTimeout: 'O servidor demorou para responder. Tente novamente.',
  readGateway: 'O servidor está reiniciando ou indisponível. Aguarde alguns segundos e tente novamente.',
  // numa gravação, a resposta pode ter se perdido depois de o servidor registrar: pedir para conferir
  writeUnknown: 'A conexão com o servidor caiu antes da resposta. Confira na tela se a ação já foi registrada antes de tentar de novo.',
} as const;

/** Identificador único da intenção de gravar: o servidor não repete a mesma gravação duas vezes. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // navegadores antigos ou página fora de HTTPS: suficiente para distinguir cliques
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const isWrite = method !== 'GET';
  // login/logout/troca de senha não são reenviados: repetir contaria tentativas e criaria sessões à toa
  const retriable = isWrite && !path.startsWith('/auth/');
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `/api${path}${qs === '?' ? '' : qs}`;
  const idempotencyKey = retriable ? newIdempotencyKey() : undefined;
  const startedAt = Date.now();

  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Requisição cancelada pela tela.', 'AbortError');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, isWrite ? TIMEOUT_MS.write : TIMEOUT_MS.read);
    const forwardAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', forwardAbort);
    const sentAt = Date.now();
    let failure: 'network' | 'timeout' | 'gateway' | null = null;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(isWrite ? { 'X-Requested-With': 'hospital-web' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      noteServerDate(res.headers.get('date'), sentAt, Date.now());
      if (GATEWAY_STATUSES.has(res.status)) failure = 'gateway';
    } catch (e) {
      if ((e as Error).name === 'AbortError' && !timedOut) throw e; // cancelado pela própria tela
      failure = timedOut ? 'timeout' : 'network';
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', forwardAbort);
    }

    if (!failure) break;
    const delay = WRITE_RETRY_DELAYS_MS[attempt];
    if (retriable && delay !== undefined && Date.now() - startedAt + delay <= WRITE_RETRY_WINDOW_MS) {
      await sleep(delay); // mesma chave: se a primeira tentativa já gravou, o servidor devolve a mesma resposta
      continue;
    }
    reportOffline();
    if (failure === 'gateway' && res) break; // segue para o tratamento de erro HTTP abaixo (com a mensagem certa)
    throw new ApiError(0, failure === 'timeout' ? 'TIMEOUT' : 'NETWORK', isWrite ? MESSAGES.writeUnknown : failure === 'timeout' ? MESSAGES.readTimeout : MESSAGES.readNetwork);
  }
  if (!res) throw new ApiError(0, 'NETWORK', isWrite ? MESSAGES.writeUnknown : MESSAGES.readNetwork);
  if (!GATEWAY_STATUSES.has(res.status)) reportOnline();

  if (res.status === 204) {
    activityListeners.forEach((l) => l());
    return undefined as T;
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const body = (data ?? {}) as { code?: string; message?: string; fieldErrors?: Record<string, string>; details?: Record<string, unknown>; requestId?: string };
    const gateway = GATEWAY_STATUSES.has(res.status);
    const err = new ApiError(
      res.status,
      gateway ? 'SERVER_UNAVAILABLE' : (body.code ?? 'ERROR'),
      gateway
        ? isWrite
          ? MESSAGES.writeUnknown
          : MESSAGES.readGateway
        : (body.message ?? (res.status >= 500 ? 'Não foi possível concluir a operação. Tente novamente.' : 'Não foi possível concluir a operação.')),
      body.fieldErrors ?? {},
      body.details ?? {},
      body.requestId,
    );
    if (res.status === 401 && !opts.silentAuth) unauthorizedListeners.forEach((l) => l(err.code));
    throw err;
  }
  activityListeners.forEach((l) => l());
  return data as T;
}

/** Falha de comunicação com o servidor (rede, demora ou servidor reiniciando) — não é erro de validação. */
export const isConnectionError = (e: unknown): boolean =>
  e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'SERVER_UNAVAILABLE');

export const get = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Não foi possível concluir a operação. Tente novamente.';
}
