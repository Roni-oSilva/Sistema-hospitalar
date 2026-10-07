'use client';

import { useEffect } from 'react';
import { serverNow } from './clock';

/**
 * Rascunho do que foi digitado e ainda NÃO foi salvo (triagem, consulta, cadastro), para nada se perder se a rede
 * cair e a tela for recarregada ou a sessão expirar no meio do caminho.
 *
 * Privacidade: fica no sessionStorage (só nesta aba; apaga ao fechar a aba), separado por usuário, apagado ao sair
 * do sistema e quando outra pessoa entra nesta aba. Nunca vai para o localStorage (ver prefs.ts) nem para o servidor.
 */
const PREFIX = 'rascunho:';
const MAX_AGE_MS = 12 * 60 * 60_000;

export interface Draft<T> {
  savedAt: number;
  /** versão do registro no servidor quando o rascunho começou (null = registro novo) */
  base: number | null;
  value: T;
}

let owner: string | null = null;

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // navegador bloqueando armazenamento: segue sem rascunho
  }
};

const keysWith = (prefix: string): string[] => {
  const s = storage();
  if (!s) return [];
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys;
};

/** Chamado pela sessão: rascunhos de outra pessoa nesta aba são descartados. */
export function setDraftOwner(userId: string | null): void {
  owner = userId;
  if (!userId) return;
  for (const k of keysWith(PREFIX)) if (!k.startsWith(`${PREFIX}${userId}:`)) storage()?.removeItem(k);
}

/** Ao sair do sistema: nada fica para trás. */
export function clearAllDrafts(): void {
  for (const k of keysWith(PREFIX)) storage()?.removeItem(k);
}

/** Chave do rascunho do usuário atual (null se ainda não há sessão: sem rascunho). */
export const draftKey = (kind: 'triagem' | 'consulta' | 'cadastro', id: string): string | null => (owner ? `${PREFIX}${owner}:${kind}:${id}` : null);

export function clearDraft(key: string | null): void {
  if (key) storage()?.removeItem(key);
}

/**
 * Lê o rascunho para restaurar. Só devolve se ele partiu da MESMA versão que está no servidor (senão o registro
 * mudou depois e o rascunho poderia apagar a mudança) e se tem menos de 12 h.
 */
export function takeDraft<T>(key: string | null, base: number | null): Draft<T> | null {
  if (!key) return null;
  const s = storage();
  try {
    const raw = s?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    if (d.base !== base || serverNow() - d.savedAt > MAX_AGE_MS) {
      s?.removeItem(key);
      return null;
    }
    return d;
  } catch {
    s?.removeItem(key);
    return null;
  }
}

/** Grava o rascunho (com pequena espera) enquanto houver algo pendente; apaga quando não houver mais. */
export function useDraftPersistence<T>(key: string | null, value: T, pending: boolean, base: number | null, ready = true): void {
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!key || !ready) return;
    if (!pending) {
      clearDraft(key);
      return;
    }
    const t = window.setTimeout(() => {
      try {
        storage()?.setItem(key, JSON.stringify({ savedAt: serverNow(), base, value: JSON.parse(serialized) as T }));
      } catch {
        /* armazenamento cheio ou bloqueado: segue sem rascunho */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [key, serialized, pending, base, ready]);
}

/** Aviso do navegador ao fechar/recarregar a aba com algo não salvo. */
export function useUnsavedChangesWarning(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pending]);
}
