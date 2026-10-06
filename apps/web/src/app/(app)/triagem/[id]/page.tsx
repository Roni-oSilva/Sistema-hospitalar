'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Accessibility as AccessibilityIcon, Activity, CheckCircle2, ClipboardCheck, Hand, Save, ShieldAlert, Undo2 } from 'lucide-react';
import { RISK_META, SEX_LABELS, type RiskLevel } from '@hospital/shared';
import { ApiError, api, post, put } from '@/lib/api';
import { fmtDateTime, fmtMinutes, fmtTime, minutesSince } from '@/lib/format';
import type { TriageView } from '@/lib/types';
import { AccessibilityBadges, RiskBadge, RiskPicker, StatusBadge, VitalsGrid } from '@/components/clinical';
import { AccessibilityEditor, fromAccessibility, toAccessibilityInput, type AccessibilityValue } from '@/components/accessibility-editor';
import { VitalsForm, emptyVitals, parseVitals, vitalsHasValue, type VitalsDraft } from '@/components/vitals-form';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Spinner, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';

const TEXT_FIELDS = ['chiefComplaint', 'symptoms', 'symptomOnset', 'allergies', 'medicationsInUse', 'notes'] as const;
type Texts = Record<(typeof TEXT_FIELDS)[number], string>;

export default function TriageFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['attendance', id, 'triage'], queryFn: () => api<TriageView>(`/triage/${id}`) });
  const data = q.data;

  const [texts, setTexts] = useState<Texts | null>(null);
  const [dirty, setDirty] = useState(false);
  const [vitals, setVitals] = useState<VitalsDraft>(emptyVitals);
  const [vitalErrors, setVitalErrors] = useState<Record<string, string>>({});
  const [level, setLevel] = useState<RiskLevel | null>(null);
  const [observation, setObservation] = useState('');
  const [reason, setReason] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [editAcc, setEditAcc] = useState(false);
  const [acc, setAcc] = useState<AccessibilityValue | null>(null);
  const [accProfile, setAccProfile] = useState(false);

  // inicializa o formulário uma vez com o que já foi registrado (ninguém digita de novo)
  useEffect(() => {
    if (!data || texts) return;
    const t = data.triage;
    setTexts({
      chiefComplaint: t?.chiefComplaint ?? data.suggestedChiefComplaint ?? '',
      symptoms: t?.symptoms ?? '',
      symptomOnset: t?.symptomOnset ?? '',
      allergies: t?.allergies ?? '',
      medicationsInUse: t?.medicationsInUse ?? '',
      notes: t?.notes ?? '',
    });
    setDirty(!t?.chiefComplaint && Boolean(data.suggestedChiefComplaint));
    setLevel(data.currentRiskLevel);
  }, [data, texts]);

  const perms = data?.permissions;
  const editable = Boolean(perms?.canEdit);
  const correcting = Boolean(perms?.canCorrect) && !editable;
  const textEditable = editable || correcting;
  const isReclass = Boolean(data && data.currentRiskLevel && data.attendance.status !== 'EM_TRIAGEM');

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['attendance', id] });
  }, [qc, id]);

  const fail = (e: unknown, fallback: string) => {
    const msg = e instanceof ApiError ? e.message : fallback;
    setError(msg);
    toast.show('error', fallback, msg);
  };

  async function saveTexts(): Promise<boolean> {
    if (!data || !texts || !dirty) return true;
    if (correcting && correctionReason.trim().length < 5) {
      setError('Informe o motivo da correção (mínimo 5 caracteres).');
      return false;
    }
    try {
      const updated = await put<TriageView>(`/triage/${id}`, { ...texts, expectedVersion: data.triage?.version ?? 1, ...(correcting ? { correctionReason } : {}) });
      qc.setQueryData(['attendance', id, 'triage'], updated);
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EDIT_CONFLICT') {
        setError('A triagem foi alterada em outra tela. Recarregue a página para ver a versão mais recente antes de salvar.');
        return false;
      }
      fail(e, 'Não foi possível salvar a triagem');
      return false;
    }
  }

  async function submitVitals(): Promise<boolean> {
    if (!vitalsHasValue(vitals)) return true;
    const parsed = parseVitals(vitals);
    if (!parsed.ok) {
      setVitalErrors(parsed.errors);
      setError('Confira os sinais vitais destacados.');
      return false;
    }
    setVitalErrors({});
    try {
      const updated = await post<TriageView>(`/triage/${id}/vitals`, parsed.data);
      qc.setQueryData(['attendance', id, 'triage'], updated);
      setVitals(emptyVitals());
      return true;
    } catch (e) {
      if (e instanceof ApiError) setVitalErrors(e.fieldErrors);
      fail(e, 'Não foi possível registrar os sinais vitais');
      return false;
    }
  }

  async function submitClassification(): Promise<boolean> {
    if (!data || !level) return true;
    if (level === data.currentRiskLevel && !observation.trim()) return true;
    if (isReclass && reason.trim().length < 5) {
      setError('Informe o motivo da reclassificação (mínimo 5 caracteres).');
      return false;
    }
    try {
      const updated = await post<TriageView>(`/triage/${id}/classify`, { level, observation, ...(isReclass ? { reason } : {}) });
      qc.setQueryData(['attendance', id, 'triage'], updated);
      setObservation('');
      setReason('');
      return true;
    } catch (e) {
      fail(e, 'Não foi possível registrar a classificação');
      return false;
    }
  }

  async function run(label: string, steps: (() => Promise<boolean>)[], after?: () => void) {
    setError(null);
    setBusy(label);
    try {
      for (const s of steps) if (!(await s())) return;
      after?.();
    } finally {
      setBusy(null);
    }
  }

  /** Um clique: salva a queixa → registra sinais vitais → grava a classificação → envia à fila médica. */
  const finish = () =>
    run('finish', [
      saveTexts,
      submitVitals,
      async () => {
        if (!level) {
          setError('Selecione a classificação de risco antes de finalizar.');
          document.getElementById('classificacao')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return false;
        }
        return submitClassification();
      },
      async () => {
        try {
          await post(`/triage/${id}/finish`, {});
          toast.show('ok', 'Triagem finalizada', `${data?.patient.displayName} entrou na fila médica como ${RISK_META[level!].label.toUpperCase()}.`);
          qc.invalidateQueries({ queryKey: ['queue'] });
          router.push('/triagem');
          return true;
        } catch (e) {
          fail(e, 'Não foi possível finalizar a triagem');
          await refresh();
          return false;
        }
      },
    ]);

  const saveAll = () => run('save', [saveTexts, submitVitals, submitClassification], () => toast.show('ok', correcting ? 'Correção registrada' : 'Triagem salva'));

  // atalhos: Ctrl+S salva; Ctrl+Enter finaliza
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && textEditable) {
        e.preventDefault();
        void saveAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && perms?.canEdit) {
        e.preventDefault();
        void finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const waited = useMemo(() => (data ? minutesSince(data.attendance.arrivedAt) : 0), [data]);

  if (q.isLoading || (data && !texts)) return <Spinner />;
  if (q.error || !data || !texts) {
    return <Alert tone="danger" title="Não foi possível abrir a triagem">{q.error instanceof ApiError ? q.error.message : 'Tente novamente.'}</Alert>;
  }

  const setText = (k: keyof Texts) => (v: string) => {
    setTexts({ ...texts, [k]: v });
    setDirty(true);
  };

  async function saveAccessibility() {
    if (!acc) return;
    setBusy('acc');
    try {
      await put(`/attendances/${id}/accessibility`, { accessibility: toAccessibilityInput(acc), updatePatientProfile: accProfile });
      await refresh();
      setEditAcc(false);
      toast.show('ok', 'Acessibilidade atualizada');
    } catch (e) {
      fail(e, 'Não foi possível atualizar a acessibilidade');
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    const motivo = window.prompt('Motivo para devolver o paciente à fila (ex.: foi ao banheiro):');
    if (!motivo || motivo.trim().length < 3) return;
    await run('release', [saveTexts], async () => {
      try {
        await post(`/triage/${id}/release`, { reason: motivo });
        toast.show('info', 'Paciente devolvido à fila de triagem', 'Ele mantém a posição original. O rascunho foi preservado.');
        router.push('/triagem');
      } catch (e) {
        fail(e, 'Não foi possível devolver à fila');
      }
    });
  }

  async function startHere(takeover = false) {
    setBusy('start');
    try {
      await post(`/triage/${id}/start`, { takeover });
      setTexts(null);
      await refresh();
    } catch (e) {
      fail(e, 'Não foi possível iniciar a triagem');
    } finally {
      setBusy(null);
    }
  }

  const holder = data.queue?.assignedTo;

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* identificação */}
      <section aria-label="Paciente" className="flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-6 py-5">
        <div className="min-w-0">
          <p className="tabular font-mono text-sm font-semibold text-ink-3">
            Senha {data.attendance.ticket} · {data.attendance.code} · Entrada {fmtTime(data.attendance.arrivedAt)} · esperou {fmtMinutes(waited)}
          </p>
          <h1 className="mt-1 text-3xl leading-tight font-bold">{data.patient.displayName}</h1>
          <p className="text-lg text-ink-2">
            {data.patient.ageLabel} · {SEX_LABELS[data.patient.sex]} · Prontuário <span className="tabular font-mono">{data.patient.recordNumber}</span>
          </p>
          {data.attendance.reason && <p className="mt-1 text-ink-3">Motivo informado na recepção: “{data.attendance.reason}”</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AccessibilityBadges accessibility={data.accessibility} ageYears={data.patient.ageYears} />
            {perms?.canEditAccessibility && (
              <Button
                size="sm"
                variant="ghost"
                icon={<AccessibilityIcon className="size-4" aria-hidden />}
                onClick={() => {
                  setAcc(fromAccessibility(data.accessibility));
                  setEditAcc((v) => !v);
                }}
              >
                {data.accessibility.effectiveFlags.length ? 'Atualizar acessibilidade' : 'Registrar necessidade de acessibilidade'}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={data.attendance.status} />
          <RiskBadge level={data.currentRiskLevel} size="lg" />
        </div>
      </section>

      {editAcc && acc && (
        <Card>
          <CardHeader title="Acessibilidade e necessidades nesta visita" />
          <div className="flex flex-col gap-4 p-5">
            <AccessibilityEditor value={acc} onChange={setAcc} ageYears={data.patient.ageYears} />
            <Checkbox label="Também atualizar o cadastro permanente do paciente" description="Use para condições permanentes. Gestação, por exemplo, vale só para esta visita." checked={accProfile} onChange={setAccProfile} />
            <div className="flex gap-2">
              <Button loading={busy === 'acc'} onClick={() => void saveAccessibility()}>
                Salvar acessibilidade
              </Button>
              <Button variant="ghost" onClick={() => setEditAcc(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* estados que não permitem edição */}
      {data.attendance.status === 'AGUARDANDO_TRIAGEM' && perms?.canStart && (
        <Alert tone="info" title="A triagem deste paciente ainda não começou" actions={<Button loading={busy === 'start'} onClick={() => void startHere()}>Iniciar triagem</Button>} />
      )}
      {data.attendance.status === 'EM_TRIAGEM' && !editable && holder && (
        <Alert
          tone="warn"
          title={`Em triagem com ${holder.name}`}
          actions={
            perms?.canStart ? (
              <Button variant="secondary" icon={<Hand className="size-4" aria-hidden />} loading={busy === 'start'} onClick={() => window.confirm(`Assumir a triagem que está com ${holder.name}? Isso ficará registrado.`) && void startHere(true)}>
                Assumir triagem (se abandonada há 15 min ou mais)
              </Button>
            ) : undefined
          }
        >
          Somente quem está com o paciente pode editar. Os dados abaixo são apenas para consulta.
        </Alert>
      )}
      {correcting && (
        <Alert tone="info" title="Triagem finalizada — paciente aguardando o médico">
          Você ainda pode reavaliar sinais vitais, reclassificar ou corrigir informações até o médico chamar. Toda correção exige motivo e mantém a versão anterior.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" title="Atenção">
          {error}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Queixa principal" />
            <div className="p-5">
              <Textarea aria-label="Queixa principal" rows={2} className="text-lg" value={texts.chiefComplaint} onChange={(e) => setText('chiefComplaint')(e.target.value)} disabled={!textEditable} autoFocus={editable} maxLength={1000} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Sinais vitais" icon={<Activity className="size-5" />} description={perms?.canAddVitals ? 'Preencha apenas o que foi aferido. Uma nova aferição não apaga a anterior.' : undefined} />
            <div className="flex flex-col gap-5 p-5">
              {data.vitals[0] && (
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink-3">
                    Última aferição · {fmtTime(data.vitals[0].measuredAt)} · {data.vitals[0].recordedBy}
                  </p>
                  <VitalsGrid vitals={data.vitals[0]} compact />
                </div>
              )}
              {perms?.canAddVitals && (
                <>
                  {data.vitals[0] && <p className="border-t border-line pt-4 text-sm font-semibold text-ink-2">Nova aferição</p>}
                  <VitalsForm value={vitals} onChange={setVitals} errors={vitalErrors} />
                  <div>
                    <Button variant="secondary" loading={busy === 'vitals'} disabled={!vitalsHasValue(vitals)} onClick={() => void run('vitals', [submitVitals], () => toast.show('ok', 'Sinais vitais registrados'))}>
                      Registrar sinais vitais agora
                    </Button>
                  </div>
                </>
              )}
              {data.vitals.length > 1 && (
                <details className="rounded-[var(--radius-control)] border border-line px-4 py-2">
                  <summary className="cursor-pointer font-semibold text-ink-2">Aferições anteriores ({data.vitals.length - 1})</summary>
                  <div className="mt-3 flex flex-col gap-4">
                    {data.vitals.slice(1).map((v) => (
                      <div key={v.id}>
                        <p className="mb-1 text-sm text-ink-3">
                          {fmtDateTime(v.measuredAt)} · {v.recordedBy}
                        </p>
                        <VitalsGrid vitals={v} compact />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Outras informações" description="Opcionais — registre o que for relevante." />
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Sintomas" className="md:col-span-2">
                {(f) => <Textarea id={f.id} rows={2} value={texts.symptoms} onChange={(e) => setText('symptoms')(e.target.value)} disabled={!textEditable} maxLength={2000} />}
              </Field>
              <Field label="Início dos sintomas" hint="Ex.: há 2 horas, desde ontem">
                {(f) => <Input id={f.id} aria-describedby={f.describedBy} value={texts.symptomOnset} onChange={(e) => setText('symptomOnset')(e.target.value)} disabled={!textEditable} maxLength={200} />}
              </Field>
              <Field label="Alergias conhecidas">
                {(f) => <Input id={f.id} value={texts.allergies} onChange={(e) => setText('allergies')(e.target.value)} disabled={!textEditable} maxLength={500} placeholder="Ex.: dipirona; nega alergias" />}
              </Field>
              <Field label="Medicamentos em uso" className="md:col-span-2">
                {(f) => <Textarea id={f.id} rows={2} value={texts.medicationsInUse} onChange={(e) => setText('medicationsInUse')(e.target.value)} disabled={!textEditable} maxLength={1000} />}
              </Field>
              <Field label="Observações" className="md:col-span-2">
                {(f) => <Textarea id={f.id} rows={2} value={texts.notes} onChange={(e) => setText('notes')(e.target.value)} disabled={!textEditable} maxLength={2000} />}
              </Field>
              {correcting && dirty && (
                <Field label="Motivo da correção" required className="md:col-span-2">
                  {(f) => <Input id={f.id} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />}
                </Field>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card id="classificacao" className="xl:sticky xl:top-20">
            <CardHeader title="Classificação de risco" icon={<ShieldAlert className="size-5" />} description={`Protocolo: ${data.protocolName}. A decisão é sua — o sistema não sugere nível.`} />
            <div className="flex flex-col gap-4 p-5">
              <RiskPicker value={level} onChange={setLevel} disabled={!perms?.canClassify} />
              {perms?.canClassify && (
                <>
                  <Field label="Observação da classificação">
                    {(f) => <Input id={f.id} value={observation} onChange={(e) => setObservation(e.target.value)} maxLength={500} />}
                  </Field>
                  {isReclass && level !== data.currentRiskLevel && (
                    <Field label="Motivo da reclassificação" required>
                      {(f) => <Input id={f.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
                    </Field>
                  )}
                </>
              )}
              {data.classifications.length > 0 && (
                <ul className="flex flex-col gap-2 border-t border-line pt-3">
                  {data.classifications.map((c, i) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <RiskBadge level={c.level} size="sm" />
                      <span className="text-ink-2">
                        {c.classifiedBy}
                        {c.classifiedByRegister ? ` (${c.classifiedByRegister})` : ''} · {fmtTime(c.classifiedAt)}
                      </span>
                      {i === 0 && <span className="text-xs font-semibold text-ok">vigente</span>}
                      {c.reason && <span className="w-full text-ink-3">Motivo: {c.reason}</span>}
                      {c.observation && <span className="w-full text-ink-3">Obs.: {c.observation}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      {(textEditable || perms?.canClassify || perms?.canAddVitals) && (
        <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-[15.5rem]">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
            {dirty && <span className="mr-auto text-sm font-semibold text-warn">Alterações não salvas</span>}
            {perms?.canRelease && (
              <Button variant="ghost" size="lg" icon={<Undo2 className="size-5" aria-hidden />} loading={busy === 'release'} onClick={() => void release()}>
                Devolver à fila
              </Button>
            )}
            <Button variant="secondary" size="lg" kbd="Ctrl+S" icon={<Save className="size-5" aria-hidden />} loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => void saveAll()}>
              {correcting ? 'Salvar correção' : 'Salvar'}
            </Button>
            {editable && (
              <Button size="lg" kbd="Ctrl+Enter" icon={level ? <ClipboardCheck className="size-5" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />} loading={busy === 'finish'} disabled={Boolean(busy)} onClick={() => void finish()}>
                Finalizar triagem{level ? ` · ${RISK_META[level].label}` : ''}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
