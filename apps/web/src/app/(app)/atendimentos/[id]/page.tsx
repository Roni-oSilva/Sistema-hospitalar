'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { PERMISSIONS, SEX_LABELS } from '@hospital/shared';
import { ApiError, api, post } from '@/lib/api';
import { fmtDateOnly, fmtDateTime, fmtTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AttendanceDetail, TimelineEvent } from '@/lib/types';
import { AccessibilityBadges, RiskBadge, StatusBadge, Timeline } from '@/components/clinical';
import { Alert, Button, Card, CardHeader, DataItem, Field, PageHeader, Spinner, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';

/** Acompanhamento do atendimento (visão administrativa: status, horários e linha do tempo geral). */
export default function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, canAny } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const a = useQuery({ queryKey: ['attendance', id], queryFn: () => api<AttendanceDetail>(`/attendances/${id}`) });
  const tl = useQuery({ queryKey: ['attendance', id, 'timeline'], queryFn: () => api<TimelineEvent[]>(`/attendances/${id}/timeline`) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (a.isLoading) return <Spinner />;
  if (a.error || !a.data) return <Alert tone="danger">Não foi possível abrir o atendimento.</Alert>;
  const d = a.data;
  const canCancel =
    (d.status === 'AGUARDANDO_TRIAGEM' && canAny(PERMISSIONS.ATTENDANCES_CANCEL, PERMISSIONS.TRIAGE_PERFORM)) ||
    (d.status === 'EM_TRIAGEM' && can(PERMISSIONS.TRIAGE_PERFORM)) ||
    (d.status === 'AGUARDANDO_MEDICO' && can(PERMISSIONS.MEDICAL_ATTEND));

  async function cancel() {
    setErr(null);
    setBusy(true);
    try {
      await post(`/attendances/${id}/cancel`, { reason });
      toast.show('ok', 'Atendimento cancelado');
      setCancelling(false);
      qc.invalidateQueries({ queryKey: ['attendance', id] });
      qc.invalidateQueries({ queryKey: ['attendances'] });
    } catch (e) {
      setErr(e instanceof ApiError ? (e.fieldErrors.reason ?? e.message) : 'Não foi possível cancelar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`Senha ${d.ticket} · ${d.code}`}
        title={d.patient.displayName}
        description={`${fmtDateOnly(d.patient.birthDate)} · ${d.patient.ageLabel} · ${SEX_LABELS[d.patient.sex]}`}
        actions={
          <>
            {can(PERMISSIONS.CONSULTATION_READ) && ['AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO'].includes(d.status) && (
              <Link href={`/medico/atendimento/${d.id}`} className="inline-flex h-11 items-center rounded-full bg-accent px-5 font-semibold text-white hover:bg-accent-hover">
                Abrir no consultório
              </Link>
            )}
            {canCancel && !cancelling && (
              <Button variant="danger" onClick={() => setCancelling(true)} icon={<Ban className="size-4" aria-hidden />}>
                Cancelar atendimento
              </Button>
            )}
          </>
        }
      />
      {cancelling && (
        <Card className="mb-6 border-danger/50">
          <CardHeader title="Cancelar atendimento" description="Use quando o paciente desistir ou sair antes de ser atendido. O registro não é apagado." />
          <div className="flex flex-col gap-3 p-5">
            <Field label="Motivo do cancelamento" required error={err ?? undefined}>
              {(f) => <Textarea id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <Button variant="danger" loading={busy} onClick={() => void cancel()}>
                Confirmar cancelamento
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(false)}>
                Voltar
              </Button>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="self-start">
          <CardHeader title="Situação" actions={<StatusBadge status={d.status} />} />
          <dl className="grid gap-4 p-5 sm:grid-cols-2">
            <DataItem label="Chegada" value={fmtDateTime(d.arrivedAt)} mono />
            <DataItem label="Aberto por" value={d.createdBy} />
            <DataItem label="Motivo da procura" value={d.reason} />
            <DataItem label="Tipo" value={d.kind === 'RETORNO' ? 'Retorno' : 'Atendimento'} />
            <DataItem label="Início da triagem" value={fmtTime(d.triageStartedAt)} mono />
            <DataItem label="Fim da triagem" value={fmtTime(d.triageFinishedAt)} mono />
            <DataItem label="Chamado" value={fmtTime(d.firstCalledAt)} mono />
            <DataItem label="Consultório / médico" value={d.room ? `${d.room}${d.doctor ? ` · ${d.doctor}` : ''}` : null} />
            <DataItem label="Finalizado" value={fmtTime(d.finishedAt)} mono />
            {d.riskLevel && <DataItem label="Classificação" value={<RiskBadge level={d.riskLevel} size="sm" />} />}
            {d.cancelReason && <DataItem label="Motivo do cancelamento" value={d.cancelReason} />}
          </dl>
          {d.accessibility.effectiveFlags.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Acessibilidade nesta visita</p>
              <AccessibilityBadges accessibility={d.accessibility} ageYears={d.patient.ageYears} />
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Linha do tempo" />
          {tl.isLoading ? <Spinner /> : <Timeline events={tl.data ?? []} />}
        </Card>
      </div>
    </>
  );
}
