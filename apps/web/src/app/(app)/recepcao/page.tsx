'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { STATUS_LABELS, type AttendanceStatus } from '@hospital/shared';
import { api } from '@/lib/api';
import { fmtLongDate, fmtTime } from '@/lib/format';
import { useFallbackInterval } from '@/lib/realtime';
import type { AttendanceListItem } from '@/lib/types';
import { PatientSearch } from '@/components/patient-search';
import { SummaryStats } from '@/components/summary-stats';
import { AccessibilityBadges, StatusBadge } from '@/components/clinical';
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, cx } from '@/components/ui';

const FILTERS: { label: string; statuses: AttendanceStatus[] | null }[] = [
  { label: 'Todos', statuses: null },
  { label: STATUS_LABELS.AGUARDANDO_TRIAGEM, statuses: ['AGUARDANDO_TRIAGEM'] },
  { label: STATUS_LABELS.EM_TRIAGEM, statuses: ['EM_TRIAGEM'] },
  { label: STATUS_LABELS.AGUARDANDO_MEDICO, statuses: ['AGUARDANDO_MEDICO'] },
  { label: 'Em atendimento', statuses: ['EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'] },
  { label: 'Finalizados', statuses: ['ATENDIMENTO_FINALIZADO'] },
  { label: 'Cancelados', statuses: ['CANCELADO'] },
];

export default function ReceptionPage() {
  const router = useRouter();
  const [filter, setFilter] = useState(0);
  const interval = useFallbackInterval();
  const statuses = FILTERS[filter].statuses;
  const list = useQuery({
    queryKey: ['attendances', 'today', statuses?.join(',') ?? 'all'],
    queryFn: () => api<{ date: string; items: AttendanceListItem[] }>('/attendances', { query: { status: statuses?.join(',') } }),
    refetchInterval: interval,
  });

  // Alt+N → novo paciente
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        router.push('/recepcao/pacientes/novo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <>
      <PageHeader
        eyebrow={fmtLongDate()}
        title="Recepção"
        description="Busque o paciente, confirme os dados e abra o atendimento."
        actions={
          <Button size="lg" variant="secondary" kbd="Alt+N" onClick={() => router.push('/recepcao/pacientes/novo')} icon={<UserPlus className="size-5" aria-hidden />}>
            Novo paciente
          </Button>
        }
      />
      <div className="flex flex-col gap-8">
        <PatientSearch onNew={(q) => router.push(`/recepcao/pacientes/novo?nome=${encodeURIComponent(/\d/.test(q) ? '' : q)}`)} />
        <SummaryStats />
        <Card>
          <CardHeader title="Atendimentos de hoje" description="Atualiza sozinho quando a triagem ou o médico avançam o atendimento." />
          <div role="tablist" aria-label="Filtrar por situação" className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
            {FILTERS.map((f, i) => (
              <button
                key={f.label}
                role="tab"
                type="button"
                aria-selected={filter === i}
                onClick={() => setFilter(i)}
                className={cx('h-10 rounded-full border px-4 text-sm font-semibold', filter === i ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
              >
                {f.label}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <Spinner />
          ) : !list.data?.items.length ? (
            <EmptyState title="Nenhum atendimento nesta situação hoje." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-line bg-paper text-xs font-bold tracking-wider text-ink-3 uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3">Chegada</th>
                    <th scope="col" className="px-3 py-3">Senha</th>
                    <th scope="col" className="px-3 py-3">Paciente</th>
                    <th scope="col" className="px-3 py-3">Atendimento</th>
                    <th scope="col" className="px-3 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="tabular px-5 py-3 font-mono font-semibold">{fmtTime(a.arrivedAt)}</td>
                      <td className="tabular px-3 py-3 font-mono text-lg font-bold">{a.ticket}</td>
                      <td className="px-3 py-3">
                        <Link href={`/atendimentos/${a.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                          {a.patient.displayName}
                        </Link>
                        <span className="ml-2 text-sm text-ink-3">{a.patient.ageLabel}</span>
                        <div className="mt-1">
                          <AccessibilityBadges accessibility={a.accessibility} size="sm" max={3} />
                        </div>
                      </td>
                      <td className="tabular px-3 py-3 font-mono text-sm">{a.code}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
