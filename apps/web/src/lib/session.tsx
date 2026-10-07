'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_DESCRIPTIONS, type PermissionCode, type RoleCode } from '@hospital/shared';
import { ApiError, api, isConnectionError, onApiActivity, onUnauthorized } from './api';
import { clearAllDrafts, setDraftOwner } from './drafts';
import type { Me } from './types';
import { Spinner } from '@/components/ui';

interface SessionValue {
  me: Me;
  can: (p: PermissionCode) => boolean;
  canAny: (...p: PermissionCode[]) => boolean;
  /** false quando não foi possível encerrar a sessão no servidor (sem conexão): a pessoa continua na tela. */
  logout: () => Promise<boolean>;
  /** Segundos até expirar por inatividade (aproximação local; o servidor é a fonte da verdade). */
  idleSecondsLeft: number;
  keepAlive: () => Promise<void>;
}

const SessionCtx = createContext<SessionValue | null>(null);

export function homeFor(me: Me): string {
  const codes = me.user.roles.map((r) => r.code as RoleCode);
  // prioridade: o perfil operacional define a tela inicial
  for (const c of ['MEDICO', 'TRIAGEM', 'RECEPCAO', 'ADMINISTRADOR'] as RoleCode[]) {
    if (codes.includes(c)) return ROLE_DESCRIPTIONS[c].home;
  }
  return '/dashboard';
}

export function loginUrl(reason: 'inatividade' | 'sessao' | 'saiu', back?: string): string {
  const q = new URLSearchParams({ motivo: reason });
  if (back && back !== '/' && !back.startsWith('/login')) q.set('volta', back);
  return `/login?${q.toString()}`;
}

/**
 * Sessão no cliente: carrega /auth/me, protege as rotas, força a troca de senha temporária e
 * avisa antes de expirar por inatividade.
 */
export function SessionProvider({ children, allowPendingPassword = false }: { children: ReactNode; allowPendingPassword?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const redirecting = useRef(false);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me', { silentAuth: true }),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 5 * 60_000,
    // na tela "não foi possível conectar", tenta de novo sozinho até o servidor voltar
    refetchInterval: (query) => (query.state.status === 'error' && !query.state.data ? 10_000 : false),
  });

  const goLogin = useCallback(
    (reason: 'inatividade' | 'sessao' | 'saiu') => {
      if (redirecting.current) return;
      redirecting.current = true;
      qc.clear();
      router.replace(loginUrl(reason, pathname));
    },
    [qc, router, pathname],
  );

  useEffect(() => onUnauthorized((code) => goLogin(code === 'SESSION_IDLE' ? 'inatividade' : 'sessao')), [goLogin]);

  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) goLogin('sessao');
  }, [meQuery.error, goLogin]);

  const me = meQuery.data;
  useEffect(() => {
    if (me?.user.mustChangePassword && !allowPendingPassword) router.replace('/alterar-senha');
  }, [me, allowPendingPassword, router]);

  // ── contador de inatividade
  const idleMinutes = me?.session.idleMinutes ?? 30;
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => onApiActivity(() => setLastActivity(Date.now())), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const idleSecondsLeft = Math.max(0, Math.round((lastActivity + idleMinutes * 60_000 - now) / 1000));

  useEffect(() => {
    if (!me || idleSecondsLeft > 0) return;
    // confirma com o servidor (outra aba pode ter mantido a sessão ativa)
    api('/auth/session', { silentAuth: true })
      .then(() => setLastActivity(Date.now() - (idleMinutes - 1) * 60_000))
      .catch((e) => {
        // só a resposta do servidor encerra a sessão; sem conexão, confere de novo em 15 s (nada é perdido)
        if (e instanceof ApiError && e.status === 401) goLogin('inatividade');
        else setLastActivity(Date.now() - idleMinutes * 60_000 + 15_000);
      });
  }, [idleSecondsLeft, me, goLogin, idleMinutes]);

  const value = useMemo<SessionValue | null>(() => {
    if (!me) return null;
    // antes das telas montarem: rascunhos locais pertencem a este usuário (os de outra pessoa nesta aba são apagados)
    setDraftOwner(me.user.id);
    const perms = new Set(me.user.permissions);
    return {
      me,
      can: (p) => perms.has(p),
      canAny: (...p) => p.some((x) => perms.has(x)),
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST', silentAuth: true });
        } catch (e) {
          // sem conexão a sessão continuaria valendo no servidor: não finge que saiu
          if (isConnectionError(e)) return false;
        }
        clearAllDrafts();
        goLogin('saiu');
        return true;
      },
      idleSecondsLeft,
      keepAlive: async () => {
        await api('/auth/me');
      },
    };
  }, [me, idleSecondsLeft, goLogin]);

  if (meQuery.isLoading || !value) {
    if (meQuery.error && !(meQuery.error instanceof ApiError && meQuery.error.status === 401)) {
      return (
        <div className="grid min-h-screen place-items-center p-6 text-center">
          <div>
            <p className="text-lg font-semibold">Não foi possível conectar ao servidor.</p>
            <p className="text-ink-3">Verifique a rede e tente novamente.</p>
            <button className="mt-4 underline" onClick={() => meQuery.refetch()} type="button">
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return <Spinner className="min-h-screen" label="Verificando sua sessão…" />;
  }
  if (value.me.user.mustChangePassword && !allowPendingPassword) return <Spinner className="min-h-screen" label="Redirecionando…" />;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
