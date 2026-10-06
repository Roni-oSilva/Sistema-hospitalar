/**
 * Cliente HTTP da API. Regras:
 *  - mesma origem (/api), cookie httpOnly de sessão enviado automaticamente;
 *  - cabeçalho anti-CSRF exigido pela API em toda requisição que altera estado;
 *  - o funcionário NUNCA vê erro técnico: a API já devolve mensagens seguras; falhas de rede viram texto claro.
 */

import { noteServerDate } from './clock';

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

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(`/api${path}${qs === '?' ? '' : qs}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Requested-With': 'hospital-web' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique a rede e tente novamente.');
  }
  noteServerDate(res.headers.get('date'), sentAt, Date.now());

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
    const err = new ApiError(
      res.status,
      body.code ?? 'ERROR',
      body.message ?? (res.status >= 500 ? 'Não foi possível concluir a operação. Tente novamente.' : 'Não foi possível concluir a operação.'),
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

export const get = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Não foi possível concluir a operação. Tente novamente.';
}
