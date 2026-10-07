'use client';

import { useSyncExternalStore } from 'react';
import { serverNow } from './clock';

/**
 * Conexão com o SERVIDOR do hospital (não com a internet: o servidor fica na rede local).
 * Fica "sem conexão" quando uma chamada à API falha por rede, demora demais ou o servidor responde 502/503/504,
 * e volta a "conectado" na primeira resposta normal. Alimenta a faixa "Sem conexão com o servidor".
 */
type Listener = () => void;
let offlineSince: number | null = null;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export function reportOffline(): void {
  if (offlineSince !== null) return;
  offlineSince = serverNow();
  emit();
}

export function reportOnline(): void {
  if (offlineSince === null) return;
  offlineSince = null;
  emit();
}

export const getOfflineSince = (): number | null => offlineSince;

export function subscribeConnectivity(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Momento (hora do servidor) em que a conexão caiu, ou null quando está tudo bem. */
export function useOfflineSince(): number | null {
  return useSyncExternalStore(subscribeConnectivity, getOfflineSince, () => null);
}
