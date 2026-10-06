'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Hourglass, Timer } from 'lucide-react';
import { OUTCOME_LABELS, localDateString, type Outcome, type RiskLevel } from '@hospital/shared';
import { ApiError, api } from '@/lib/api';
import { fmtAvgMinutes } from '@/lib/format';
import { useFallbackInterval } from '@/lib/realtime';
import type { Summary } from '@/lib/types';
import { RiskBadge } from '@/components/clinical';
import { Alert, Card, CardHeader, Input, PageHeader, Spinner, Stat, cx } from '@/components/ui';

interface Indicators {
  date: string;
  summary: Summary;
  averageMinutes: { toTriage: number | null; medicalWait: number | null; total: number | null };
  perHour: { hour: number; count: number }[];
  byRisk: { level: RiskLevel | null; count: number }[];
  byOutcome: { outcome: Outcome | null; count: number }[];
  waitingNow: number;
}

export default function DashboardPage() {
  const today = localDateString(new Date());
  const [date, setDate] = useState(today);
  const interval = useFallbackInterval();
  const q = useQuery({
    queryKey: ['summary', 'indicators', date],
    queryFn: () => api<Indicators>('/dashboard/indicators', { query: { date } }),
    refetchInterval: date === today ? interval || 60_000 : false,
  });

  if (q.error) return <Alert tone="danger" title="Indicadores indisponíveis">{q.error instanceof ApiError ? q.error.message : 'Tente novamente.'}</Alert>;
  const d = q.data;
  const isToday = date === today;

  return (
    <>
      <PageHeader
        title="Indicadores"
        description="Somente números agregados — nenhum dado individual de paciente."
        actions={
          <label className="flex items-center gap-2 font-semibold text-ink-2">
            Dia
            <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
          </label>
        }
      />
      {!d ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <Kpi label="Atendimentos" value={d.summary.attendancesToday} strong />
            {isToday && (
              <>
                <Kpi label="Aguardando triagem" value={d.summary.waitingTriage} />
                <Kpi label="Em triagem" value={d.summary.inTriage} />
                <Kpi label="Aguardando médico" value={d.summary.waitingDoctor} />
                <Kpi label="Em atendimento" value={d.summary.inConsultation} />
              </>
            )}
            <Kpi label="Finalizados" value={d.summary.finishedToday} />
            <Kpi label="Cancelados" value={d.summary.cancelledToday} />
          </dl>

          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Tempo médio até a triagem" value={fmtAvgMinutes(d.averageMinutes.toTriage)} icon={<Clock className="size-4" aria-hidden />} />
            <Stat label="Espera média pelo médico" value={fmtAvgMinutes(d.averageMinutes.medicalWait)} icon={<Hourglass className="size-4" aria-hidden />} />
            <Stat label="Tempo total médio" value={fmtAvgMinutes(d.averageMinutes.total)} icon={<Timer className="size-4" aria-hidden />} />
          </div>

          <Card>
            <CardHeader title="Por classificação de risco" description="Atendimentos do dia pela classificação vigente." />
            <ul className="grid gap-3 p-5 sm:grid-cols-3 xl:grid-cols-6">
              {d.byRisk.map((r) => (
                <li key={r.level ?? 'none'} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line px-4 py-3">
                  <RiskBadge level={r.level} size="sm" className="self-start" />
                  <span className="tabular font-mono text-3xl font-bold">{r.count}</span>
                </li>
              ))}
            </ul>
          </Card>

          <PerHourChart data={d.perHour} />

          <Card>
            <CardHeader title="Desfechos dos atendimentos finalizados" />
            {d.byOutcome.length === 0 ? (
              <p className="px-5 py-6 text-ink-3">Nenhum atendimento finalizado neste dia.</p>
            ) : (
              <ul className="grid gap-3 p-5 sm:grid-cols-5">
                {d.byOutcome.map((o) => (
                  <li key={o.outcome ?? 'x'} className="rounded-[var(--radius-control)] border border-line px-4 py-3">
                    <p className="text-sm font-semibold text-ink-3">{o.outcome ? OUTCOME_LABELS[o.outcome] : '—'}</p>
                    <p className="tabular font-mono text-3xl font-bold">{o.count}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-1 rounded-[var(--radius-card)] border px-4 py-3', strong ? 'brand-gradient border-transparent text-white shadow-[var(--shadow-float)]' : 'glass')}>
      <dt className={cx('text-xs font-bold tracking-wider uppercase', strong ? 'text-white/70' : 'text-ink-3')}>{label}</dt>
      <dd className="tabular font-display text-4xl leading-none font-extrabold">{value}</dd>
    </div>
  );
}

/**
 * Atendimentos por hora: uma série → uma cor (tinta neutra), colunas finas com topo arredondado de 4px
 * apoiadas na linha de base, 2px de vão, rótulo direto só no pico, tooltip por coluna e versão em tabela.
 */
function PerHourChart({ data }: { data: { hour: number; count: number }[] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.count));
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <Card>
      <CardHeader
        title="Chegadas por hora"
        description={total ? `Pico às ${String(peak.hour).padStart(2, '0')}h com ${peak.count} chegada(s).` : 'Sem chegadas neste dia.'}
        actions={
          <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setTable((v) => !v)} aria-pressed={table}>
            {table ? 'Ver como gráfico' : 'Ver como tabela'}
          </button>
        }
      />
      {table ? (
        <div className="overflow-x-auto p-5">
          <table className="w-full text-left">
            <thead className="text-xs font-bold tracking-wider text-ink-3 uppercase">
              <tr>
                <th scope="col" className="py-1">Hora</th>
                <th scope="col" className="py-1 text-right">Chegadas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.hour} className="border-t border-line">
                  <td className="tabular py-1 font-mono">{String(d.hour).padStart(2, '0')}h</td>
                  <td className="tabular py-1 text-right font-mono">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <figure className="px-5 pt-6 pb-4">
          <div className="relative flex h-48 items-end gap-[2px] border-b border-line-strong" role="img" aria-label={`Chegadas por hora. Total ${total}. ${total ? `Pico às ${peak.hour} horas com ${peak.count}.` : ''}`}>
            {/* linhas de grade recessivas */}
            {[0.5, 1].map((f) => (
              <span key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${f * 100}%` }} aria-hidden />
            ))}
            {data.map((d) => (
              <div key={d.hour} className="group relative flex h-full flex-1 items-end" title={`${String(d.hour).padStart(2, '0')}h: ${d.count} chegada(s)`}>
                <div className="w-full rounded-t-[4px] bg-brand-mid transition-colors group-hover:bg-accent" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0 }} />
                {d.hour === peak.hour && d.count > 0 && (
                  <span className="tabular absolute -top-6 left-1/2 -translate-x-1/2 font-mono text-sm font-bold text-ink">{d.count}</span>
                )}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-ink px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block" aria-hidden>
                  {String(d.hour).padStart(2, '0')}h · {d.count}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px]" aria-hidden>
            {data.map((d) => (
              <span key={d.hour} className="tabular flex-1 text-center font-mono text-[0.65rem] text-ink-3">
                {d.hour % 3 === 0 ? String(d.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
          <figcaption className="mt-2 text-xs text-ink-3">Hora local do hospital (America/Belém).</figcaption>
        </figure>
      )}
    </Card>
  );
}
