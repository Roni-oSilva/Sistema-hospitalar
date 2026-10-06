'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, BellRing, DoorOpen, Megaphone, Undo2 } from 'lucide-react';
import { PERMISSIONS } from '@hospital/shared';
import { ApiError, api, post } from '@/lib/api';
import { fmtMinutes, fmtTime, minutesSince } from '@/lib/format';
import { prefs } from '@/lib/prefs';
import { useFallbackInterval } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import type { CallResult, MedicalQueue, MedicalQueueItem, Room } from '@/lib/types';
import { AccessibilityBadges, RISK_STYLE, RiskBadge, SexLabel } from '@/components/clinical';
import { Alert, Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function MedicalQueuePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useSession();
  const interval = useFallbackInterval();
  const now = useNow();
  const [roomId, setRoomId] = useState<string>('');
  const [lastCall, setLastCall] = useState<CallResult | null>(null);

  const rooms = useQuery({ queryKey: ['rooms', 'active'], queryFn: () => api<Room[]>('/rooms', { query: { active: true } }), refetchInterval: interval || 60_000 });
  const q = useQuery({ queryKey: ['queue', 'MEDICA'], queryFn: () => api<MedicalQueue>('/medical/queue'), refetchInterval: interval });

  useEffect(() => {
    const saved = prefs.roomId();
    if (saved) setRoomId(saved);
  }, []);
  useEffect(() => {
    if (rooms.data && roomId && !rooms.data.some((r) => r.id === roomId)) setRoomId('');
  }, [rooms.data, roomId]);

  const onCalled = (r: CallResult) => {
    setLastCall(r);
    qc.invalidateQueries({ queryKey: ['queue', 'MEDICA'] });
    qc.invalidateQueries({ queryKey: ['rooms'] });
    toast.show('ok', `${r.code} chamado`, `Senha ${r.ticket} — dirija-se ao ${r.room}.`);
    router.push(`/medico/atendimento/${r.attendanceId}`);
  };
  const onCallError = (e: unknown) => {
    const err = e instanceof ApiError ? e : null;
    toast.show(err?.code === 'QUEUE_EMPTY' ? 'info' : 'error', err?.code === 'QUEUE_EMPTY' ? 'Fila vazia' : 'Não foi possível chamar', err?.message);
    qc.invalidateQueries({ queryKey: ['queue', 'MEDICA'] });
  };

  const callNext = useMutation({ mutationFn: () => post<CallResult>('/medical/queue/call-next', { roomId }), onSuccess: onCalled, onError: onCallError });
  const callOne = useMutation({ mutationFn: (id: string) => post<CallResult>(`/medical/attendances/${id}/call`, { roomId }), onSuccess: onCalled, onError: onCallError });
  const recall = useMutation({
    mutationFn: (id: string) => post<CallResult>(`/medical/attendances/${id}/recall`),
    onSuccess: (r) => toast.show('ok', 'Chamado novamente', `Senha ${r.ticket} — ${r.room}`),
    onError: onCallError,
  });
  const release = useMutation({
    mutationFn: (id: string) => post(`/medical/attendances/${id}/release`, { reason: 'Não compareceu à chamada' }),
    onSuccess: () => {
      toast.show('info', 'Paciente devolvido à fila', 'Ele mantém a posição original.');
      qc.invalidateQueries({ queryKey: ['queue', 'MEDICA'] });
    },
    onError: onCallError,
  });

  const mine = q.data?.mine ?? null;
  const waiting = q.data?.waiting ?? [];
  const canCall = can(PERMISSIONS.MEDICAL_CALL) && Boolean(roomId) && !mine;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C') && canCall && !callNext.isPending) {
        e.preventDefault();
        callNext.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCall, callNext]);

  const room = rooms.data?.find((r) => r.id === roomId);

  return (
    <>
      <PageHeader title="Fila médica" description="Ordenada pela classificação de risco feita na triagem e, depois, pela ordem de chegada." />

      <section aria-label="Meu consultório" className="mb-6 grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-64 flex-col gap-1.5">
            <label htmlFor="room" className="text-sm font-semibold text-ink-2">
              Estou atendendo no
            </label>
            <Select
              id="room"
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                prefs.setRoomId(e.target.value || null);
              }}
              className="h-14 text-lg"
            >
              <option value="">Selecione o consultório…</option>
              {rooms.data?.map((r) => (
                <option key={r.id} value={r.id} disabled={Boolean(r.occupiedBy) && r.id !== roomId}>
                  {r.name}
                  {r.occupiedBy ? ` — em uso (${r.occupiedBy})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-6">
            <div>
              <p className="text-xs font-bold tracking-wider text-ink-3 uppercase">Aguardando</p>
              <p className="tabular font-display text-4xl leading-none font-extrabold">{waiting.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-wider text-ink-3 uppercase">Acima do tempo-alvo</p>
              <p className={cx('tabular font-display text-4xl leading-none font-extrabold', waiting.some((w) => w.overdue) && 'text-danger')}>{waiting.filter((w) => w.overdue).length}</p>
            </div>
          </div>
        </div>
        <Button
          size="xl"
          disabled={!canCall || waiting.length === 0}
          loading={callNext.isPending}
          onClick={() => callNext.mutate()}
          kbd="Alt+C"
          icon={<Megaphone className="size-7" aria-hidden />}
          title={!roomId ? 'Selecione o consultório' : mine ? 'Finalize ou devolva o paciente atual' : undefined}
        >
          Chamar próximo
        </Button>
        {!roomId && <p className="text-sm font-semibold text-warn lg:col-span-2">Selecione o consultório para poder chamar pacientes.</p>}
      </section>

      {mine && (
        <Card className="mb-6 border-2 border-accent">
          <CardHeader title="Você está com este paciente" icon={<DoorOpen className="size-5" />} />
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <QueuePatient item={mine} now={now} />
            <div className="ml-auto flex flex-wrap gap-2">
              {mine.queueStatus === 'CALLED' && (
                <>
                  <Button variant="secondary" size="lg" icon={<BellRing className="size-5" aria-hidden />} loading={recall.isPending} onClick={() => recall.mutate(mine.attendanceId)}>
                    Chamar novamente
                  </Button>
                  <Button variant="ghost" size="lg" icon={<Undo2 className="size-5" aria-hidden />} loading={release.isPending} onClick={() => window.confirm('Devolver o paciente à fila (não compareceu)?') && release.mutate(mine.attendanceId)}>
                    Não compareceu
                  </Button>
                </>
              )}
              <Link href={`/medico/atendimento/${mine.attendanceId}`} className="inline-flex h-14 items-center gap-2 rounded-full bg-accent px-6 text-lg font-semibold text-white shadow-[0_8px_20px_-10px_rgb(15_61_125/0.7)] hover:bg-accent-hover">
                {mine.queueStatus === 'CALLED' ? 'Abrir e iniciar atendimento' : 'Continuar atendimento'} <ArrowRight className="size-5" aria-hidden />
              </Link>
            </div>
          </div>
          {mine.queueStatus === 'CALLED' && lastCall?.attendanceId === mine.attendanceId && (
            <p className="border-t border-line px-5 py-3 text-ink-2">
              Painel: <strong className="tabular font-mono">{lastCall.code}</strong> — dirija-se ao <strong>{lastCall.room}</strong>
            </p>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={room ? `${room.name} · aguardando atendimento` : 'Aguardando atendimento'} />
        {q.isLoading ? (
          <Spinner />
        ) : waiting.length === 0 ? (
          <EmptyState title="Nenhum paciente aguardando." icon={<DoorOpen className="size-10" />}>
            Pacientes aparecem aqui assim que a triagem é finalizada.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {waiting.map((i, idx) => (
              <li key={i.attendanceId} className="relative flex flex-wrap items-center gap-4 py-4 pr-5 pl-7">
                <span className={cx('absolute inset-y-0 left-0 w-2', RISK_STYLE[i.riskLevel].bar)} aria-hidden />
                <span className="tabular w-8 font-mono text-2xl font-bold text-ink-3" aria-label={`Posição ${idx + 1}`}>
                  {idx + 1}
                </span>
                <QueuePatient item={i} now={now} />
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant={idx === 0 ? 'primary' : 'secondary'}
                    disabled={!canCall || callOne.isPending}
                    loading={callOne.isPending && callOne.variables === i.attendanceId}
                    onClick={() => {
                      if (idx > 0 && !window.confirm('Este paciente não é o próximo da fila. Chamar mesmo assim? (ficará registrado)')) return;
                      callOne.mutate(i.attendanceId);
                    }}
                  >
                    {idx === 0 ? 'Chamar' : 'Chamar fora da ordem'}
                  </Button>
                  <Link href={`/medico/atendimento/${i.attendanceId}`} className="inline-flex h-11 items-center rounded-full px-4 font-semibold text-accent hover:bg-accent-soft">
                    Ver
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {(q.data?.inService.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader title="Em atendimento com outros médicos" />
          <ul className="divide-y divide-line">
            {q.data!.inService.map((i) => (
              <li key={i.attendanceId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <RiskBadge level={i.riskLevel} size="sm" />
                <span className="font-semibold">{i.patient.displayName}</span>
                <span className="text-ink-3">
                  {i.assignedTo?.name} · {i.room} · {i.queueStatus === 'CALLED' ? `chamado às ${fmtTime(i.calledAt)}` : 'em consulta'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {mine === null && waiting.length > 0 && !roomId && <Alert tone="info" className="mt-4">Escolha o consultório no topo para liberar o botão “Chamar próximo”.</Alert>}
    </>
  );
}

function QueuePatient({ item, now }: { item: MedicalQueueItem; now: number }) {
  const wait = minutesSince(item.enqueuedAt, now);
  const overdue = item.queueStatus === 'WAITING' && wait > item.maxWaitMinutes;
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RiskBadge level={item.riskLevel} />
        <span className="text-xl font-bold">{item.patient.displayName}</span>
        <span className="text-ink-2">
          {item.patient.ageLabel} · <SexLabel sex={item.patient.sex} />
        </span>
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 text-ink-2">
        <span className="tabular font-mono text-sm">{item.code}</span>
        <span className={cx(overdue && 'font-bold text-danger')}>
          {overdue && <AlertTriangle className="mr-1 inline size-4" aria-hidden />}
          Esperando <span className="tabular font-mono">{fmtMinutes(wait)}</span>
          <span className="text-sm text-ink-3"> (alvo {fmtMinutes(item.maxWaitMinutes)})</span>
          {overdue && <span className="sr-only"> — acima do tempo-alvo</span>}
        </span>
      </p>
      {item.chiefComplaint && <p className="mt-0.5 text-ink-3">Queixa: {item.chiefComplaint}</p>}
      <div className="mt-1.5">
        <AccessibilityBadges accessibility={item.accessibility} ageYears={item.patient.ageYears} size="sm" />
      </div>
    </div>
  );
}
