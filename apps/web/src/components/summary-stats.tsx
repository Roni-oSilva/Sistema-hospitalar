'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFallbackInterval } from '@/lib/realtime';
import type { Summary } from '@/lib/types';
import { cx } from './ui';

/** Contadores do dia — números grandes, sem gráficos. Atualizam em tempo real. */
export function SummaryStats({ include = ['today', 'waitingTriage', 'inTriage', 'waitingDoctor', 'inConsultation', 'finished'] }: { include?: (keyof typeof LABELS)[] }) {
  const interval = useFallbackInterval();
  const q = useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/dashboard/summary'), refetchInterval: interval });
  const d = q.data;
  const values: Record<keyof typeof LABELS, number | undefined> = {
    today: d?.attendancesToday,
    waitingTriage: d?.waitingTriage,
    inTriage: d?.inTriage,
    waitingDoctor: d?.waitingDoctor,
    inConsultation: d?.inConsultation,
    finished: d?.finishedToday,
  };
  return (
    <dl className={cx('grid gap-3 sm:grid-cols-3', include.length >= 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5')}>
      {include.map((k) => (
        <div key={k} className={cx('flex flex-col gap-1 rounded-[var(--radius-card)] border px-4 py-3', k === 'today' ? 'brand-gradient border-transparent text-white shadow-[var(--shadow-float)]' : 'glass')}>
          <dt className={cx('text-xs font-bold tracking-wider uppercase', k === 'today' ? 'text-white/70' : 'text-ink-3')}>{LABELS[k]}</dt>
          <dd className="tabular font-display text-4xl leading-none font-extrabold" aria-live="polite">
            {values[k] ?? '–'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const LABELS = {
  today: 'Atendimentos hoje',
  waitingTriage: 'Aguardando triagem',
  inTriage: 'Em triagem',
  waitingDoctor: 'Aguardando médico',
  inConsultation: 'Em atendimento',
  finished: 'Atendidos hoje',
};
