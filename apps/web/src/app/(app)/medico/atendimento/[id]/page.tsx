'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  FilePlus2,
  History,
  PencilLine,
  Pill,
  Plus,
  Save,
  ShieldAlert,
  Stethoscope,
  Undo2,
  X,
} from 'lucide-react';
import { OUTCOMES, OUTCOME_LABELS, RISK_META, SEX_LABELS, type Outcome, type RiskLevel } from '@hospital/shared';
import { ApiError, api, post, put } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format';
import type { HistoryItem, MedicalView } from '@/lib/types';
import { AccessibilityBadges, AccessibilityDetails, AllergyNote, deniesAllergy, RiskBadge, RiskPicker, StatusBadge, Timeline, VitalsGrid } from '@/components/clinical';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, LoadError, Spinner, Textarea, cx } from '@/components/ui';
import { useToast } from '@/components/toast';
import { DraftRestoredNotice, StaleDataNotice } from '@/components/draft-notice';
import { clearDraft, draftKey, takeDraft, useDraftPersistence, useUnsavedChangesWarning } from '@/lib/drafts';

type Texts = Record<'chiefComplaint' | 'history' | 'examination' | 'conduct', string>;
const emptyItem = { medication: '', dose: '', route: '', frequency: '', duration: '', notes: '' };
const emptyDx = { code: '', description: '', isPrimary: false };
/** O que fica guardado no rascunho local enquanto não é salvo. */
interface ConsultationDraft {
  texts: Texts;
  dirty: boolean;
  item: typeof emptyItem;
  dx: typeof emptyDx;
  outcome: Outcome | null;
  finalNotes: string;
  note: string;
  correcting: boolean;
  correctionReason: string;
}

export default function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['attendance', id, 'medical'];
  const q = useQuery({ queryKey: key, queryFn: () => api<MedicalView>(`/medical/attendances/${id}`) });
  const d = q.data;

  const [texts, setTexts] = useState<Texts | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState(emptyItem);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [dx, setDx] = useState({ code: '', description: '', isPrimary: false });
  const [dxErrors, setDxErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [finalNotes, setFinalNotes] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [reclass, setReclass] = useState<{ open: boolean; level: RiskLevel | null; reason: string }>({ open: false, level: null, reason: '' });
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState('');
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const dKey = draftKey('consulta', id);

  const history = useQuery({ queryKey: ['attendance', id, 'history'], queryFn: () => api<HistoryItem[]>(`/medical/attendances/${id}/history`), enabled: showHistory });

  // sincroniza o formulário com o registro do servidor (início, ou quando outra tela salvou)
  useEffect(() => {
    if (!d?.consultation) return;
    if (texts && !dirty && baseVersion === d.consultation.version) return;
    if (texts && dirty) return;
    const c = d.consultation;
    if (!texts) {
      // a rede caiu / a tela recarregou antes de salvar? recupera o que tinha sido digitado
      const draft = takeDraft<ConsultationDraft>(draftKey('consulta', id), c.version);
      if (draft) {
        const v = draft.value;
        setTexts(v.texts);
        setDirty(v.dirty);
        setItem(v.item);
        setDx(v.dx);
        setOutcome(v.outcome);
        setFinalNotes(v.finalNotes);
        setNote(v.note);
        setCorrecting(v.correcting);
        setCorrectionReason(v.correctionReason);
        setBaseVersion(c.version);
        setRestoredAt(draft.savedAt);
        return;
      }
    }
    setTexts({ chiefComplaint: c.chiefComplaint ?? '', history: c.history ?? '', examination: c.examination ?? '', conduct: c.conduct ?? '' });
    setBaseVersion(c.version);
  }, [d, texts, dirty, baseVersion, id]);

  // tudo que ainda não chegou ao servidor (texto, medicação/diagnóstico em digitação, desfecho) vira rascunho local
  const isFinished = d?.attendance.status === 'ATENDIMENTO_FINALIZADO';
  const pending =
    Boolean(texts) &&
    (dirty ||
      Object.values(item).some((v) => v.trim() !== '') ||
      dx.code.trim() !== '' ||
      dx.description.trim() !== '' ||
      note.trim() !== '' ||
      correctionReason.trim() !== '' ||
      (!isFinished && (outcome !== null || finalNotes.trim() !== '')));
  useDraftPersistence<ConsultationDraft | null>(
    dKey,
    texts ? { texts, dirty, item, dx, outcome, finalNotes, note, correcting, correctionReason } : null,
    pending,
    baseVersion,
    Boolean(texts) && baseVersion !== null,
  );
  // aviso ao fechar/recarregar com algo não salvo
  useUnsavedChangesWarning(pending);

  const editable = Boolean(d?.permissions.canEdit);
  const textEditable = editable || (correcting && Boolean(d?.permissions.canCorrect));

  const apply = (v: MedicalView) => qc.setQueryData(key, v);
  const fail = (e: unknown, title: string) => {
    const msg = e instanceof ApiError ? e.message : 'Tente novamente.';
    setError(msg);
    toast.show('error', title, msg);
  };

  async function saveTexts(): Promise<boolean> {
    if (!texts || !dirty || baseVersion === null) return true;
    try {
      const v = await put<MedicalView>(`/medical/attendances/${id}/consultation`, { ...texts, expectedVersion: baseVersion, ...(correcting ? { correctionReason } : {}) });
      setDirty(false);
      setBaseVersion(v.consultation?.version ?? null);
      apply(v);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EDIT_CONFLICT') setError('O atendimento foi alterado em outra tela. Copie o seu texto, recarregue a página e salve novamente.');
      else fail(e, 'Não foi possível salvar o atendimento');
      return false;
    }
  }

  async function act<T>(label: string, fn: () => Promise<T>, ok?: (r: T) => void) {
    setError(null);
    setBusy(label);
    try {
      const r = await fn();
      ok?.(r);
    } catch (e) {
      fail(e, 'Não foi possível concluir');
    } finally {
      setBusy(null);
    }
  }

  // Ctrl+S salva
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && textEditable) {
        e.preventDefault();
        void (async () => {
          setBusy('save');
          if (await saveTexts()) toast.show('ok', 'Atendimento salvo');
          setBusy(null);
        })();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (q.isLoading) return <Spinner />;
  // só bloqueia a tela quando nunca houve dados; uma atualização que falha não esconde o formulário
  if (!d) return <LoadError title="Não foi possível abrir o atendimento" error={q.error} onRetry={() => void q.refetch()} />;

  const discardDraft = () => {
    clearDraft(dKey);
    setRestoredAt(null);
    setItem(emptyItem);
    setDx(emptyDx);
    setOutcome(null);
    setFinalNotes('');
    setNote('');
    setCorrecting(false);
    setCorrectionReason('');
    setDirty(false);
    setTexts(null); // reabre com o que está salvo no servidor
  };

  const p = d.permissions;
  const activeItems = d.prescriptionItems.filter((i) => !i.canceled);
  const finished = d.attendance.status === 'ATENDIMENTO_FINALIZADO';
  const setText = (k: keyof Texts) => (v: string) => {
    setTexts((t) => ({ ...(t as Texts), [k]: v }));
    setDirty(true);
  };

  async function addItem() {
    setItemErrors({});
    await act('item', async () => {
      if (!(await saveTexts())) return;
      try {
        const v = await post<MedicalView>(`/medical/attendances/${id}/prescription/items`, item);
        apply(v);
        setItem(emptyItem);
        document.querySelector<HTMLInputElement>('input[name="med-name"]')?.focus();
        toast.show('ok', 'Medicação adicionada');
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setItemErrors(e.fieldErrors);
        else throw e;
      }
    });
  }

  async function addDiagnosis() {
    setDxErrors({});
    await act('dx', async () => {
      try {
        const v = await post<MedicalView>(`/medical/attendances/${id}/diagnoses`, dx);
        apply(v);
        setDx(emptyDx);
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setDxErrors(e.fieldErrors);
        else throw e;
      }
    });
  }

  async function finish() {
    if (!outcome) {
      setError('Selecione o desfecho do atendimento.');
      document.getElementById('desfecho')?.focus();
      return;
    }
    await act('finish', async () => {
      if (!(await saveTexts())) return;
      const v = await post<MedicalView>(`/medical/attendances/${id}/finish`, { outcome, finalNotes });
      apply(v);
      clearDraft(dKey);
      qc.invalidateQueries({ queryKey: ['queue'] });
      toast.show('ok', 'Atendimento finalizado', `${d!.patient.displayName} · ${OUTCOME_LABELS[outcome]}`);
    });
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <Link href="/medico" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Fila médica
      </Link>

      {/* 1. PACIENTE */}
      <section aria-label="Paciente" className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-6 py-5">
        {d.risk && <span className={cx('absolute inset-y-0 left-0 w-2', d.risk.level === 'EMERGENCIA' ? 'bg-risk-red' : d.risk.level === 'MUITO_URGENTE' ? 'bg-risk-orange' : d.risk.level === 'URGENTE' ? 'bg-risk-yellow' : d.risk.level === 'POUCO_URGENTE' ? 'bg-risk-green' : 'bg-risk-blue')} aria-hidden />}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="tabular font-mono text-sm font-semibold text-ink-3">
              {d.attendance.code} · Senha {d.attendance.ticket} · Prontuário {d.patient.recordNumber} · Entrada {fmtTime(d.attendance.arrivedAt)}
            </p>
            <h1 className="mt-1 text-3xl leading-tight font-bold">{d.patient.displayName}</h1>
            <p className="text-lg text-ink-2">
              {d.patient.ageLabel} · {SEX_LABELS[d.patient.sex]}
              {d.patient.motherName ? ` · Mãe: ${d.patient.motherName}` : ''}
            </p>
            <div className="mt-2">
              <AccessibilityBadges accessibility={d.accessibility} ageYears={d.patient.ageYears} />
              <AccessibilityDetails accessibility={d.accessibility} className="mt-1" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <RiskBadge level={d.risk?.level ?? null} size="lg" />
            <StatusBadge status={d.attendance.status} />
          </div>
        </div>
        <AllergyNote allergies={d.triage?.allergies} className="mt-4" />
      </section>

      {/* estado da chamada */}
      {p.canStart && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border-2 border-accent bg-accent-soft px-5 py-4">
          <p className="mr-auto text-lg">
            Chamado para o <strong>{d.queue?.room?.name}</strong> às {fmtTime(d.queue?.calledAt)} {d.queue && d.queue.callCount > 1 ? `(${d.queue.callCount}ª chamada)` : ''}
          </p>
          <Button variant="ghost" size="lg" icon={<Undo2 className="size-5" aria-hidden />} loading={busy === 'release'} onClick={() => window.confirm('Devolver o paciente à fila (não compareceu)?') && void act('release', () => post(`/medical/attendances/${id}/release`, { reason: 'Não compareceu' }), () => router.push('/medico'))}>
            Não compareceu
          </Button>
          <Button variant="secondary" size="lg" icon={<BellRing className="size-5" aria-hidden />} loading={busy === 'recall'} onClick={() => void act('recall', () => post(`/medical/attendances/${id}/recall`), () => toast.show('ok', 'Paciente chamado novamente'))}>
            Chamar novamente
          </Button>
          <Button size="xl" icon={<Stethoscope className="size-7" aria-hidden />} loading={busy === 'start'} onClick={() => void act('start', () => post<MedicalView>(`/medical/attendances/${id}/start`), (v) => apply(v))}>
            Paciente chegou — iniciar
          </Button>
        </div>
      )}
      {d.attendance.status === 'AGUARDANDO_MEDICO' && !p.canStart && (
        <Alert tone="info" title="Paciente aguardando na fila">
          {d.queue?.assignedTo ? `Chamado por ${d.queue.assignedTo.name} (${d.queue.room?.name}).` : 'Chame-o pela fila médica para iniciar o atendimento.'}
        </Alert>
      )}
      {restoredAt !== null && <DraftRestoredNotice savedAt={restoredAt} onDiscard={discardDraft} />}
      {q.error && <StaleDataNotice onRetry={() => void q.refetch()} />}
      {error && <Alert tone="danger" title="Atenção">{error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
        {/* COLUNA CLÍNICA (dados já registrados — nada para redigitar) */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Triagem" description={d.triage?.finishedBy ? `${d.triage.finishedBy}${d.triage.finishedByRegister ? ` · ${d.triage.finishedByRegister}` : ''} · ${fmtTime(d.triage.finishedAt)}` : undefined} />
            <div className="flex flex-col gap-4 p-5">
              <div>
                <p className="text-xs font-bold tracking-wider text-ink-3 uppercase">Queixa</p>
                <p className="text-xl font-semibold">{d.triage?.chiefComplaint ?? d.attendance.reason ?? '—'}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold tracking-wider text-ink-3 uppercase">Sinais vitais {d.latestVitals && `· ${fmtTime(d.latestVitals.measuredAt)}`}</p>
                <VitalsGrid vitals={d.latestVitals} compact />
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                {d.triage?.symptoms && <Info label="Sintomas" value={d.triage.symptoms} />}
                {d.triage?.symptomOnset && <Info label="Início" value={d.triage.symptomOnset} />}
                <Info label="Medicamentos em uso" value={d.triage?.medicationsInUse ?? 'Não informado'} />
                {d.triage?.notes && <Info label="Observações" value={d.triage.notes} />}
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Classificação de risco"
              icon={<ShieldAlert className="size-5" />}
              actions={p.canReclassify && !reclass.open ? <Button size="sm" variant="ghost" onClick={() => setReclass({ open: true, level: d.risk?.level ?? null, reason: '' })}>Reclassificar</Button> : undefined}
            />
            <div className="flex flex-col gap-3 p-5">
              {d.risk && (
                <p className="text-ink-2">
                  <RiskBadge level={d.risk.level} /> por {d.risk.classifiedBy}
                  {d.risk.classifiedByRegister ? ` (${d.risk.classifiedByRegister})` : ''} às {fmtTime(d.risk.classifiedAt)} · {d.risk.protocol}
                </p>
              )}
              {d.risk?.observation && <p className="text-sm text-ink-3">Obs.: {d.risk.observation}</p>}
              {reclass.open && (
                <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-3">
                  <RiskPicker value={reclass.level} onChange={(l) => setReclass({ ...reclass, level: l })} />
                  <Field label="Motivo da reclassificação" required>
                    {(f) => <Input id={f.id} value={reclass.reason} onChange={(e) => setReclass({ ...reclass, reason: e.target.value })} />}
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      loading={busy === 'reclass'}
                      disabled={!reclass.level || reclass.level === d.risk?.level}
                      onClick={() =>
                        void act('reclass', () => post(`/triage/${id}/classify`, { level: reclass.level, reason: reclass.reason }), async () => {
                          setReclass({ open: false, level: null, reason: '' });
                          await qc.invalidateQueries({ queryKey: key });
                          toast.show('ok', 'Classificação alterada');
                        })
                      }
                    >
                      Confirmar {reclass.level ? RISK_META[reclass.level].label : ''}
                    </Button>
                    <Button variant="ghost" onClick={() => setReclass({ open: false, level: null, reason: '' })}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {p.canViewHistory && (
            <Card>
              <CardHeader
                title="Histórico disponível"
                icon={<History className="size-5" />}
                description={d.previousAttendances ? `${d.previousAttendances} atendimento(s) anterior(es) finalizado(s) neste hospital` : 'Sem atendimentos anteriores neste hospital'}
                actions={d.previousAttendances > 0 ? <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Ocultar' : 'Ver histórico'}</Button> : undefined}
              />
              {showHistory && (
                <div className="p-5">
                  {history.isLoading ? (
                    <Spinner />
                  ) : (
                    <ol className="flex flex-col gap-4">
                      {history.data?.map((h) => (
                        <li key={h.id} className="rounded-[var(--radius-control)] border border-line p-3">
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            <span className="tabular font-mono">{fmtDate(h.arrivedAt)}</span>
                            {h.riskLevel && <RiskBadge level={h.riskLevel} size="sm" />}
                            <span className="text-ink-3">{h.outcomeLabel}</span>
                          </p>
                          <p className="text-ink-2">{h.chiefComplaint}</p>
                          {h.diagnoses.length > 0 && <p className="text-sm">Diagnóstico: {h.diagnoses.map((x) => `${x.code ? `${x.code} ` : ''}${x.description}`).join('; ')}</p>}
                          {h.medications.length > 0 && <p className="text-sm">Medicação: {h.medications.map((m) => `${m.medication} ${m.dose}`).join('; ')}</p>}
                          {h.allergies && <p className={cx('text-sm', deniesAllergy(h.allergies) ? 'text-ink-2' : 'font-semibold text-danger')}>Alergias: {h.allergies}</p>}
                          <p className="text-xs text-ink-3">{h.doctor}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* COLUNA DO ATENDIMENTO MÉDICO */}
        <div className="flex flex-col gap-6">
          {d.consultation && texts ? (
            <>
              <Card>
                <CardHeader
                  title="Atendimento médico"
                  icon={<Stethoscope className="size-5" />}
                  description={`${d.consultation.doctor.name}${d.consultation.doctor.register ? ` · ${d.consultation.doctor.register}` : ''} · início ${fmtTime(d.consultation.startedAt)}`}
                  actions={
                    finished && p.canCorrect && !correcting ? (
                      <Button size="sm" variant="secondary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => setCorrecting(true)}>
                        Corrigir registro
                      </Button>
                    ) : undefined
                  }
                />
                <div className="flex flex-col gap-4 p-5">
                  {correcting && <Alert tone="info">Correção de atendimento finalizado: a versão anterior fica preservada e o motivo é obrigatório.</Alert>}
                  <Field label="Queixa principal">
                    {(f) => <Textarea id={f.id} rows={2} value={texts.chiefComplaint} onChange={(e) => setText('chiefComplaint')(e.target.value)} disabled={!textEditable} />}
                  </Field>
                  <Field label="História / evolução">
                    {(f) => <Textarea id={f.id} rows={5} value={texts.history} onChange={(e) => setText('history')(e.target.value)} disabled={!textEditable} autoFocus={editable && !texts.history} />}
                  </Field>
                  <Field label="Exame / avaliação">
                    {(f) => <Textarea id={f.id} rows={5} value={texts.examination} onChange={(e) => setText('examination')(e.target.value)} disabled={!textEditable} />}
                  </Field>
                </div>
              </Card>

              <Card>
                <CardHeader title="Diagnóstico" description="CID-10 opcional. Registre conforme o fluxo clínico adotado." />
                <div className="flex flex-col gap-4 p-5">
                  {d.diagnoses.length === 0 && <p className="text-ink-3">Nenhum diagnóstico registrado.</p>}
                  <ul className="flex flex-col gap-2">
                    {d.diagnoses.map((x) => (
                      <li key={x.id} className={cx('flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2', x.removed && 'opacity-60')}>
                        {x.code && <span className="tabular rounded bg-sunken px-2 py-0.5 font-mono text-sm font-bold">{x.code}</span>}
                        <span className={cx('font-semibold', x.removed && 'line-through')}>{x.description}</span>
                        {x.isPrimary && !x.removed && <span className="text-xs font-bold text-accent uppercase">principal</span>}
                        {x.removed && <span className="text-xs text-ink-3">removido: {x.removalReason}</span>}
                        {editable && !x.removed && (
                          <button
                            type="button"
                            className="ml-auto rounded p-2 text-ink-3 hover:bg-sunken"
                            aria-label={`Remover diagnóstico ${x.description}`}
                            onClick={() => {
                              const reason = window.prompt('Motivo da remoção do diagnóstico:');
                              if (reason && reason.trim().length >= 5) void act('dxrm', () => post<MedicalView>(`/medical/attendances/${id}/diagnoses/${x.id}/remove`, { reason }), apply);
                            }}
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {editable && (
                    <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-end">
                      <Field label="CID-10" error={dxErrors.code}>
                        {(f) => <Input id={f.id} invalid={f.invalid} placeholder="R07.4" value={dx.code} onChange={(e) => setDx({ ...dx, code: e.target.value.toUpperCase() })} className="tabular font-mono" />}
                      </Field>
                      <Field label="Descrição" error={dxErrors.description}>
                        {(f) => <Input id={f.id} invalid={f.invalid} value={dx.description} onChange={(e) => setDx({ ...dx, description: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addDiagnosis())} />}
                      </Field>
                      <Checkbox label="Principal" checked={dx.isPrimary} onChange={(v) => setDx({ ...dx, isPrimary: v })} />
                      <Button variant="secondary" loading={busy === 'dx'} onClick={() => void addDiagnosis()} icon={<Plus className="size-4" aria-hidden />}>
                        Adicionar
                      </Button>
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Conduta" />
                <div className="p-5">
                  <Textarea aria-label="Conduta" rows={4} value={texts.conduct} onChange={(e) => setText('conduct')(e.target.value)} disabled={!textEditable} />
                </div>
              </Card>

              <Card>
                <CardHeader title="Medicação / prescrição" icon={<Pill className="size-5" />} description="O sistema não sugere nem prescreve: tudo aqui é decisão do médico responsável." />
                <div className="flex flex-col gap-4 p-5">
                  {d.prescriptionItems.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="text-xs font-bold tracking-wider text-ink-3 uppercase">
                          <tr>
                            <th scope="col" className="py-2 pr-3">#</th>
                            <th scope="col" className="py-2 pr-3">Medicamento</th>
                            <th scope="col" className="py-2 pr-3">Dose</th>
                            <th scope="col" className="py-2 pr-3">Via</th>
                            <th scope="col" className="py-2 pr-3">Frequência</th>
                            <th scope="col" className="py-2 pr-3">Duração</th>
                            <th scope="col" className="py-2"><span className="sr-only">Ações</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.prescriptionItems.map((i) => (
                            <tr key={i.id} className={cx('border-t border-line align-top', i.canceled && 'text-ink-3')}>
                              <td className="tabular py-2 pr-3 font-mono">{i.position}</td>
                              <td className="py-2 pr-3">
                                <span className={cx('font-semibold', i.canceled && 'line-through')}>{i.medication}</span>
                                {i.notes && <span className="block text-sm text-ink-3">{i.notes}</span>}
                                {i.canceled && <span className="block text-xs">Cancelado: {i.cancelReason}</span>}
                              </td>
                              <td className="py-2 pr-3">{i.dose}</td>
                              <td className="py-2 pr-3">{i.route}</td>
                              <td className="py-2 pr-3">{i.frequency}</td>
                              <td className="py-2 pr-3">{i.duration}</td>
                              <td className="py-2 text-right">
                                {editable && !i.canceled && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const reason = window.prompt('Motivo do cancelamento do item:');
                                      if (reason && reason.trim().length >= 5) void act('itemrm', () => post<MedicalView>(`/medical/attendances/${id}/prescription/items/${i.id}/cancel`, { reason }), apply);
                                    }}
                                  >
                                    Cancelar
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {editable && (
                    <fieldset className="grid gap-3 rounded-[var(--radius-control)] border border-line bg-paper p-4 md:grid-cols-6">
                      <legend className="px-1 text-sm font-semibold text-ink-2">Adicionar medicação</legend>
                      <Field label="Medicamento" required className="md:col-span-3" error={itemErrors.medication}>
                        {(f) => <Input id={f.id} name="med-name" invalid={f.invalid} value={item.medication} onChange={(e) => setItem({ ...item, medication: e.target.value })} />}
                      </Field>
                      <Field label="Dose" required className="md:col-span-3" error={itemErrors.dose}>
                        {(f) => <Input id={f.id} invalid={f.invalid} value={item.dose} onChange={(e) => setItem({ ...item, dose: e.target.value })} />}
                      </Field>
                      <Field label="Via" required className="md:col-span-2" error={itemErrors.route}>
                        {(f) => (
                          <>
                            <Input id={f.id} invalid={f.invalid} list="vias" value={item.route} onChange={(e) => setItem({ ...item, route: e.target.value })} />
                            <datalist id="vias">
                              {['Oral', 'Intravenosa', 'Intramuscular', 'Subcutânea', 'Sublingual', 'Inalatória', 'Tópica', 'Retal', 'Oftálmica', 'Nasal'].map((v) => (
                                <option key={v} value={v} />
                              ))}
                            </datalist>
                          </>
                        )}
                      </Field>
                      <Field label="Frequência" required className="md:col-span-2" error={itemErrors.frequency}>
                        {(f) => <Input id={f.id} invalid={f.invalid} placeholder="Ex.: 8/8 h, dose única" value={item.frequency} onChange={(e) => setItem({ ...item, frequency: e.target.value })} />}
                      </Field>
                      <Field label="Duração" required className="md:col-span-2" error={itemErrors.duration}>
                        {(f) => <Input id={f.id} invalid={f.invalid} placeholder="Ex.: 5 dias" value={item.duration} onChange={(e) => setItem({ ...item, duration: e.target.value })} />}
                      </Field>
                      <Field label="Observação" className="md:col-span-4">
                        {(f) => <Input id={f.id} value={item.notes} onChange={(e) => setItem({ ...item, notes: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addItem())} />}
                      </Field>
                      <div className="flex items-end md:col-span-2">
                        <Button className="w-full" loading={busy === 'item'} onClick={() => void addItem()} icon={<Plus className="size-4" aria-hidden />}>
                          Adicionar
                        </Button>
                      </div>
                    </fieldset>
                  )}
                  {!editable && d.prescriptionItems.length === 0 && <p className="text-ink-3">Nenhuma medicação registrada.</p>}
                </div>
              </Card>

              {/* DESFECHO */}
              {editable && (
                <Card className="border-2 !border-accent/40">
                  <CardHeader title="Finalização do atendimento" />
                  <div className="flex flex-col gap-4 p-5">
                    <fieldset>
                      <legend id="desfecho" tabIndex={-1} className="mb-2 text-sm font-semibold text-ink-2">
                        Desfecho
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {OUTCOMES.map((o) => (
                          <label key={o} className={cx('flex h-12 cursor-pointer items-center gap-2 rounded-full border-2 px-5 font-semibold', outcome === o ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface')}>
                            <input type="radio" name="outcome" className="sr-only" checked={outcome === o} onChange={() => setOutcome(o)} />
                            {outcome === o ? <CheckCircle2 className="size-5" aria-hidden /> : <span className="size-5 rounded-full border-2 border-line-strong" aria-hidden />}
                            {OUTCOME_LABELS[o]}
                          </label>
                        ))}
                      </div>
                      {outcome === 'MEDICADO' && activeItems.length === 0 && <p className="mt-2 text-sm text-warn">Para “Medicado”, adicione ao menos uma medicação.</p>}
                    </fieldset>
                    <Field label="Observações finais" hint={outcome === 'OUTRO' ? 'Obrigatório para o desfecho “Outro”.' : undefined}>
                      {(f) => <Textarea id={f.id} aria-describedby={f.describedBy} rows={3} value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} />}
                    </Field>
                  </div>
                </Card>
              )}

              {finished && (
                <Card className="border-ok">
                  <CardHeader title="Atendimento finalizado" icon={<CheckCircle2 className="size-5 text-ok" />} description={`${fmtDateTime(d.consultation.finishedAt)} · ${d.consultation.outcomeLabel}`} />
                  <div className="flex flex-col gap-3 p-5">
                    {d.consultation.finalNotes && <p>{d.consultation.finalNotes}</p>}
                    {d.notes.length > 0 && (
                      <ul className="flex flex-col gap-2">
                        {d.notes.map((n) => (
                          <li key={n.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                            <span className="font-bold">{n.type === 'CORRECAO' ? 'Correção' : 'Complemento'}</span> · {n.author} · {fmtDateTime(n.createdAt)}
                            <p className="whitespace-pre-wrap text-ink-2">{n.content}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.canAddNote && (
                      <div className="flex flex-col gap-2">
                        <Field label="Adicionar complemento ao registro">
                          {(f) => <Textarea id={f.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
                        </Field>
                        <Button
                          variant="secondary"
                          className="self-start"
                          icon={<FilePlus2 className="size-4" aria-hidden />}
                          loading={busy === 'note'}
                          disabled={note.trim().length < 3}
                          onClick={() => void act('note', () => post<MedicalView>(`/medical/attendances/${id}/notes`, { content: note }), (v) => (apply(v), setNote('')))}
                        >
                          Registrar complemento
                        </Button>
                      </div>
                    )}
                    {correcting && (
                      <Field label="Motivo da correção" required>
                        {(f) => <Input id={f.id} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />}
                      </Field>
                    )}
                  </div>
                </Card>
              )}
            </>
          ) : (
            d.attendance.status !== 'AGUARDANDO_MEDICO' && <Alert tone="info">O atendimento médico ainda não foi iniciado.</Alert>
          )}

          <Card>
            <CardHeader title="Linha do tempo" />
            <Timeline events={d.timeline} />
            {d.versions.length > 0 && (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink-2">Versões anteriores dos registros clínicos ({d.versions.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {d.versions.map((v) => (
                    <li key={v.id}>
                      {v.recordType === 'TRIAGEM' ? 'Triagem' : 'Consulta'} v{v.version} · {v.changedBy} · {fmtDateTime(v.createdAt)}
                      {v.changeReason ? ` · ${v.changeReason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </div>
      </div>

      {(editable || correcting) && d.consultation && (
        <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-[15.5rem]">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
            {dirty && <span className="mr-auto text-sm font-semibold text-warn">Alterações não salvas</span>}
            <Button
              variant="secondary"
              size="lg"
              kbd="Ctrl+S"
              icon={<Save className="size-5" aria-hidden />}
              loading={busy === 'save'}
              disabled={!dirty || Boolean(busy) || (correcting && correctionReason.trim().length < 5)}
              onClick={() =>
                void act('save', saveTexts, (ok) => {
                  if (ok) {
                    toast.show('ok', correcting ? 'Correção registrada' : 'Atendimento salvo');
                    if (correcting) setCorrecting(false);
                  }
                })
              }
            >
              {correcting ? 'Salvar correção' : 'Salvar'}
            </Button>
            {editable && (
              <Button size="lg" icon={<CheckCircle2 className="size-5" aria-hidden />} loading={busy === 'finish'} disabled={Boolean(busy)} onClick={() => void finish()}>
                Finalizar atendimento{outcome ? ` · ${OUTCOME_LABELS[outcome]}` : ''}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold tracking-wider text-ink-3 uppercase">{label}</dt>
      <dd className="whitespace-pre-wrap text-ink">{value}</dd>
    </div>
  );
}
