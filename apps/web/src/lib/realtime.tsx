'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { REALTIME_EVENTS, type AttendanceChangedEvent, type QueueChangedEvent } from '@hospital/shared';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';
const Ctx = createContext<RealtimeStatus>('connecting');

/** URL do Socket.IO: mesma origem em produção (via Nginx); em desenvolvimento, a API local. */
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

/**
 * Tempo real: o servidor avisa "algo mudou" (só IDs) e a tela rebusca os dados pela API.
 * Ninguém precisa apertar F5. Se a conexão cair, as filas passam a se atualizar sozinhas a cada 15 s.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    const socket = io(SOCKET_URL, { path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
    socket.on('connect', () => {
      setStatus('online');
      // ao reconectar, garante que nada ficou para trás
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['attendances'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on(REALTIME_EVENTS.QUEUE_CHANGED, (e: QueueChangedEvent) => {
      qc.invalidateQueries({ queryKey: ['queue', e.kind] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    });
    socket.on(REALTIME_EVENTS.ATTENDANCE_CHANGED, (e: AttendanceChangedEvent) => {
      qc.invalidateQueries({ queryKey: ['attendances'] });
      qc.invalidateQueries({ queryKey: ['attendance', e.attendanceId] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    });
    socket.on(REALTIME_EVENTS.NOTIFICATION, () => qc.invalidateQueries({ queryKey: ['notifications'] }));
    return () => {
      socket.close();
    };
  }, [qc]);

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}

export const useRealtimeStatus = (): RealtimeStatus => useContext(Ctx);

/** Intervalo de atualização de segurança: desligado quando o tempo real está ativo. */
export function useFallbackInterval(): number | false {
  const status = useRealtimeStatus();
  return status === 'online' ? false : 15_000;
}
