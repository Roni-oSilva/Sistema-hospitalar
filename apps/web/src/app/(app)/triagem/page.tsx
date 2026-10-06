'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, Hand, UserCheck } from 'lucide-react';
import { CLAIM_STALE_MINUTES } from '@hospital/shared';
import { ApiError, api, post } from '@/lib/api';
import { fmtMinutes, fmtTime, minutesSince } from '@/lib/format';
import { useFallbackInterval } from '@/lib/realtime';
import type { TriageQueueItem } from '@/lib/types';
import { AccessibilityBadges, RiskBadge, SexLabel } from '@/components/clinical';
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function TriageQueuePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const interval = useFallbackInterval();
  const now = useNow();
  const q = useQuery({ queryKey: ['queue', 'TRIAGEM'], queryFn: () => api<{ waiting: TriageQueueItem[]; inProgress: TriageQueueItem[] }>('/triage/queue'), refetchInterval: interval });

  const start = useMutation({
    mutationFn: ({ id, takeover }: { id: string; takeover?: boolean }) => post(`/triage/${id}/start`, { takeover: Boolean(takeover) }),
    onSuccess: (_d, v) => router.push(`/triagem/${v.id}`),
    onError: (e) => {
      toast.show('error', 'Não foi possível iniciar a triagem', e instanceof ApiError ? e.message : undefined);
      qc.invalidateQueries({ queryKey: ['queue', 'TRIAGEM'] });
    },
  });

  const waiting = useMemo(() => q.data?.waiting ?? [], [q.data]);
  const mine = (q.data?.inProgress ?? []).filter((i) => i.assignedTo?.isMe);
  const others = (q.data?.inProgress ?? []).filter((i) => !i.assignedTo?.isMe);

  // Alt+T → inicia a triagem do próximo da fila
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 't' || e.key === 'T') && waiting[0] && !start.isPending) {
        e.preventDefault();
        start.mutate({ id: waiting[0].attendanceId });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [waiting, start]);

  return (
    <>
      <PageHeader
        title="Triagem"
        description="Ordem de chegada. A cor aparece somente depois da classificação feita por você."
        actions={
          <div className="flex gap-3">
            <Counter label="Aguardando" value={waiting.length} />
            <Counter label="Em triagem" value={q.data?.inProgress.length ?? 0} />
          </div>
        }
      />

      {mine.length > 0 && (
        <Card className="mb-6 border-accent">
          <CardHeader title="Em triagem com você" icon={<UserCheck className="size-5" />} />
          <ul className="divide-y divide-line">
            {mine.map((i) => (
              <li key={i.attendanceId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <PatientCell item={i} now={now} />
                <Link href={`/triagem/${i.attendanceId}`} className="ml-auto inline-flex h-14 items-center gap-2 rounded-full bg-accent px-6 text-lg font-semibold text-white shadow-[0_8px_20px_-10px_rgb(15_61_125/0.7)] hover:bg-accent-hover">
                  Continuar triagem <ArrowRight className="size-5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Aguardando triagem" description={waiting.length ? `${waiting.length} paciente(s) na fila` : undefined} icon={<ClipboardList className="size-5" />} />
        {q.isLoading ? (
          <Spinner />
        ) : waiting.length === 0 ? (
          <EmptyState title="Ninguém aguardando triagem." icon={<ClipboardList className="size-10" />}>
            Novos atendimentos aparecem aqui automaticamente.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {waiting.map((i, idx) => (
              <li key={i.attendanceId} className={cx('flex flex-wrap items-center gap-4 px-5 py-4', idx === 0 && 'bg-accent-soft/40')}>
                <span className="tabular w-10 shrink-0 font-mono text-2xl font-bold text-ink-3" aria-label={`Posição ${idx + 1}`}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <PatientCell item={i} now={now} />
                <Button
                  size="lg"
                  variant={idx === 0 ? 'primary' : 'secondary'}
                  className="ml-auto"
                  loading={start.isPending && start.variables?.id === i.attendanceId}
                  disabled={start.isPending}
                  kbd={idx === 0 ? 'Alt+T' : undefined}
                  onClick={() => start.mutate({ id: i.attendanceId })}
                >
                  Iniciar triagem
                </Button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {others.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Em triagem com outros profissionais" />
          <ul className="divide-y divide-line">
            {others.map((i) => {
              const idle = i.startedAt ? minutesSince(i.startedAt, now) : 0;
              const stale = idle >= CLAIM_STALE_MINUTES;
              return (
                <li key={i.attendanceId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <PatientCell item={i} now={now} />
                  <span className="text-ink-2">
                    com <strong>{i.assignedTo?.name}</strong> há {fmtMinutes(idle)}
                  </span>
                  {stale && (
                    <Button
                      variant="secondary"
                      className="ml-auto"
                      icon={<Hand className="size-4" aria-hidden />}
                      onClick={() => {
                        if (window.confirm(`Assumir a triagem que está com ${i.assignedTo?.name}? Isso ficará registrado.`)) start.mutate({ id: i.attendanceId, takeover: true });
                      }}
                    >
                      Assumir triagem
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2 text-center">
      <p className="text-xs font-bold tracking-wider text-ink-3 uppercase">{label}</p>
      <p className="tabular font-display text-3xl leading-none font-extrabold">{value}</p>
    </div>
  );
}

function PatientCell({ item, now }: { item: TriageQueueItem; now: number }) {
  const wait = minutesSince(item.arrivedAt, now);
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xl font-bold">{item.patient.displayName}</span>
        {item.riskLevel && <RiskBadge level={item.riskLevel} size="sm" />}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-4 text-ink-2">
        <span>
          {item.patient.ageLabel} · <SexLabel sex={item.patient.sex} />
        </span>
        <span>
          Entrada <strong className="tabular font-mono">{fmtTime(item.arrivedAt)}</strong>
        </span>
        <span className={cx(wait >= 30 && 'font-semibold text-warn')}>
          Esperando <span className="tabular font-mono">{fmtMinutes(wait)}</span>
        </span>
        <span className="tabular font-mono text-sm text-ink-3">
          Senha {item.ticket} · {item.code}
        </span>
      </p>
      {item.reason && <p className="mt-0.5 text-sm text-ink-3">Motivo informado: {item.reason}</p>}
      <div className="mt-1.5">
        <AccessibilityBadges accessibility={item.accessibility} ageYears={item.patient.ageYears} size="sm" />
      </div>
    </div>
  );
}
