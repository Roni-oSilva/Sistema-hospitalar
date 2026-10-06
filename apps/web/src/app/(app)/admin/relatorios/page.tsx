'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACCESSIBILITY_FLAG_META, localDateString, type AccessibilityFlag, type RiskLevel } from '@hospital/shared';
import { ApiError, api } from '@/lib/api';
import { fmtAvgMinutes, fmtDateOnly } from '@/lib/format';
import { RiskBadge } from '@/components/clinical';
import { Alert, Card, CardHeader, Input, PageHeader, Spinner, Stat } from '@/components/ui';

interface Overview {
  period: { from: string; to: string };
  totals: { attendances: number; finished: number; cancelled: number; distinctPatients: number };
  averageMinutes: { toTriage: number | null; medicalWait: number | null; total: number | null };
  perDay: { day: string; total: number; finished: number; cancelled: number }[];
  byRisk: { level: RiskLevel | null; total: number; avgMedicalWaitMinutes: number | null }[];
  ageBands: { band: string; total: number }[];
  accessibility: { flag: AccessibilityFlag; total: number | string }[];
  productivity: { doctors: { name: string; finished: number; avgMinutes: number | null }[]; triage: { name: string; finished: number }[] };
  eventsBySector: { code: string; sector: string; total: number }[];
}

const m = fmtAvgMinutes;

/** Relatórios agregados por período. Grupos de acessibilidade com menos de 3 casos aparecem como "<3" (anti-reidentificação). */
export default function ReportsPage() {
  const today = localDateString(new Date());
  const monthStart = `${today.slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useQuery({ queryKey: ['reports', from, to], queryFn: () => api<Overview>('/reports/overview', { query: { from, to } }), enabled: Boolean(from && to && from <= to) });
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Números agregados do período — sem identificação de pacientes."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
              De
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
              Até
              <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </label>
          </div>
        }
      />
      {q.error && <Alert tone="danger">{q.error instanceof ApiError ? q.error.message : 'Não foi possível gerar o relatório.'}</Alert>}
      {q.isLoading && <Spinner label="Gerando relatório…" />}
      {d && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Atendimentos" value={d.totals.attendances} />
            <Stat label="Pacientes distintos" value={d.totals.distinctPatients} />
            <Stat label="Finalizados" value={d.totals.finished} tone="ok" />
            <Stat label="Cancelados" value={d.totals.cancelled} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Média até a triagem" value={m(d.averageMinutes.toTriage)} />
            <Stat label="Espera média pelo médico" value={m(d.averageMinutes.medicalWait)} />
            <Stat label="Tempo total médio" value={m(d.averageMinutes.total)} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Por classificação de risco" />
              <Table head={['Classificação', 'Atendimentos', 'Espera média pelo médico']} rows={d.byRisk.map((r) => [<RiskBadge key="b" level={r.level as RiskLevel | null} size="sm" />, r.total, m(r.avgMedicalWaitMinutes)])} />
            </Card>
            <Card>
              <CardHeader title="Faixa etária" />
              <Table head={['Faixa', 'Atendimentos']} rows={d.ageBands.map((a) => [`${a.band} anos`, a.total])} />
            </Card>
            <Card>
              <CardHeader title="Indicadores de acessibilidade" description="Registrados nas visitas do período." />
              <Table head={['Necessidade', 'Visitas']} rows={d.accessibility.filter((a) => a.total !== 0).map((a) => [ACCESSIBILITY_FLAG_META[a.flag].label, a.total])} empty="Nenhuma necessidade registrada no período." />
            </Card>
            <Card>
              <CardHeader title="Eventos por setor" description="Registros na linha do tempo por setor de origem." />
              <Table head={['Setor', 'Eventos']} rows={d.eventsBySector.map((s) => [s.sector, s.total])} />
            </Card>
            <Card>
              <CardHeader title="Produtividade — médicos" />
              <Table head={['Profissional', 'Finalizados', 'Duração média']} rows={d.productivity.doctors.map((x) => [x.name, x.finished, m(x.avgMinutes)])} empty="Sem atendimentos finalizados." />
            </Card>
            <Card>
              <CardHeader title="Produtividade — triagem" />
              <Table head={['Profissional', 'Triagens finalizadas']} rows={d.productivity.triage.map((x) => [x.name, x.finished])} empty="Sem triagens finalizadas." />
            </Card>
          </div>

          <Card>
            <CardHeader title="Por dia" />
            <Table head={['Dia', 'Atendimentos', 'Finalizados', 'Cancelados']} rows={d.perDay.map((p) => [fmtDateOnly(p.day), p.total, p.finished, p.cancelled])} empty="Sem atendimentos no período." />
          </Card>
        </div>
      )}
    </>
  );
}

function Table({ head, rows, empty = 'Sem dados.' }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-ink-3">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="border-b border-line bg-paper text-xs font-bold tracking-wider text-ink-3 uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? 'px-5 py-2' : 'px-3 py-2 text-right'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? 'px-5 py-2' : 'tabular px-3 py-2 text-right font-mono'}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
