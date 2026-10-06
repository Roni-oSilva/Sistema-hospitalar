'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPlus, Printer, Search, SlidersHorizontal } from 'lucide-react';
import { SEX_LABELS } from '@hospital/shared';
import { ApiError, api, post } from '@/lib/api';
import { fmtDateOnly, fmtDateTime } from '@/lib/format';
import { prefs } from '@/lib/prefs';
import type { PatientDetail, PublicSettings } from '@/lib/types';
import { AccessibilityBadges } from '@/components/clinical';
import { AccessibilityEditor, fromAccessibility, toAccessibilityInput, type AccessibilityValue } from '@/components/accessibility-editor';
import { Alert, Button, Card, CardHeader, Field, PageHeader, Spinner, Textarea, cx } from '@/components/ui';

interface Created {
  id: string;
  code: string;
  ticket: string;
  status: string;
  arrivedAt: string;
  patientName: string;
}

function NewAttendanceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const patientId = params.get('patientId');
  const patient = useQuery({ queryKey: ['patient', patientId], queryFn: () => api<PatientDetail>(`/patients/${patientId}`), enabled: Boolean(patientId) });
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public'), staleTime: 600_000 });

  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'ATENDIMENTO' | 'RETORNO'>('ATENDIMENTO');
  const [adjust, setAdjust] = useState(false);
  const [acc, setAcc] = useState<AccessibilityValue | null>(null);
  const [error, setError] = useState<{ message: string; active?: { id: string; code: string } } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (patient.data && !acc) setAcc(fromAccessibility(patient.data.accessibility));
  }, [patient.data, acc]);
  useEffect(() => {
    if (created) doneRef.current?.focus();
  }, [created]);

  if (!patientId) {
    return (
      <Alert tone="info" title="Escolha o paciente primeiro" actions={<Link className="font-semibold text-accent underline" href="/recepcao">Ir para a busca</Link>}>
        O atendimento é sempre aberto a partir de um paciente já identificado.
      </Alert>
    );
  }
  if (patient.isLoading || !acc) return <Spinner />;
  if (patient.error || !patient.data) return <Alert tone="danger">Paciente não encontrado.</Alert>;
  const p = patient.data;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await post<Created>('/attendances', {
        patientId,
        kind,
        reason,
        deviceLabel: prefs.deviceLabel() ?? undefined,
        ...(adjust && acc ? { accessibility: toAccessibilityInput(acc) } : {}),
      });
      setCreated(res);
      qc.invalidateQueries({ queryKey: ['attendances'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['patient-search'] });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError({ message: err.message, active: err.code === 'ACTIVE_ATTENDANCE_EXISTS' ? (err.details as { id: string; code: string }) : undefined });
      } else setError({ message: 'Não foi possível criar o atendimento. Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="rounded-[var(--radius-card)] border-2 border-ok bg-surface p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-ok" aria-hidden />
          <h1 ref={doneRef} tabIndex={-1} className="mt-3 text-2xl font-bold focus:outline-none">
            Atendimento criado e enviado para a triagem
          </h1>
          <p className="mt-1 text-ink-3">{created.patientName}</p>
          <div className="print-ticket mx-auto mt-6 max-w-sm rounded-[var(--radius-card)] border border-dashed border-line-strong p-6">
            <p className="text-sm font-semibold text-ink-3">{settings.data?.hospitalName ?? 'Hospital Municipal de Ulianópolis'}</p>
            <p className="mt-3 text-sm font-bold tracking-widest text-ink-3 uppercase">Senha</p>
            <p className="tabular font-mono text-7xl leading-none font-bold">{created.ticket}</p>
            <p className="tabular mt-3 font-mono text-lg font-semibold">{created.code}</p>
            <p className="mt-1 text-sm text-ink-3">{fmtDateTime(created.arrivedAt)}</p>
            <p className="mt-3 text-sm">Aguarde ser chamado(a) pelo painel.</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" variant="secondary" onClick={() => window.print()} icon={<Printer className="size-5" aria-hidden />}>
            Imprimir senha
          </Button>
          <Button size="lg" autoFocus onClick={() => router.push('/recepcao')} icon={<Search className="size-5" aria-hidden />}>
            Próximo paciente
          </Button>
          <Link href={`/atendimentos/${created.id}`} className="inline-flex h-14 items-center rounded-full px-5 font-semibold text-accent hover:bg-accent-soft">
            Acompanhar este atendimento
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Novo atendimento" description="Confirme o paciente e registre o motivo da procura." />
      <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_2fr]" noValidate>
        <Card className="self-start">
          <CardHeader title="Paciente" />
          <div className="flex flex-col gap-3 p-5">
            <p className="text-2xl leading-tight font-bold">{p.displayName}</p>
            <p className="text-ink-2">
              {fmtDateOnly(p.birthDate)} · {p.ageLabel} · {SEX_LABELS[p.sex]}
            </p>
            <p className="text-sm text-ink-3">
              Prontuário <span className="tabular font-mono font-semibold text-ink">{p.recordNumber}</span>
            </p>
            <AccessibilityBadges accessibility={p.accessibility} ageYears={p.ageYears} />
            <Link href={`/recepcao/pacientes/${p.id}`} className="text-sm font-semibold text-accent hover:underline">
              Conferir ou atualizar o cadastro
            </Link>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          {error && (
            <Alert
              tone="danger"
              title="Não foi possível criar o atendimento"
              actions={error.active ? <Link className="font-semibold text-accent underline" href={`/atendimentos/${error.active.id}`}>Abrir o atendimento {error.active.code}</Link> : undefined}
            >
              {error.message}
            </Alert>
          )}
          <Card>
            <CardHeader title="Atendimento" />
            <div className="flex flex-col gap-5 p-5">
              <Field label="Motivo da procura" hint="Em poucas palavras, o que trouxe o paciente (a triagem detalha depois)." error={fieldErrors.reason}>
                {(f) => <Textarea id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} rows={3} maxLength={500} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="text-lg" />}
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink-2">Tipo</legend>
                <div className="flex flex-wrap gap-2">
                  {(['ATENDIMENTO', 'RETORNO'] as const).map((k) => (
                    <label key={k} className={cx('flex h-12 cursor-pointer items-center gap-2 rounded-full border px-5 font-semibold', kind === k ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface')}>
                      <input type="radio" name="kind" className="accent-[var(--color-accent)]" checked={kind === k} onChange={() => setKind(k)} />
                      {k === 'ATENDIMENTO' ? 'Atendimento' : 'Retorno'}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Acessibilidade nesta visita"
              description={adjust ? 'Ajuste o que vale para hoje (ex.: gestante, precisa de cadeira de rodas).' : 'Usando o perfil do cadastro.'}
              actions={
                <Button variant={adjust ? 'ghost' : 'secondary'} onClick={() => setAdjust((v) => !v)} icon={<SlidersHorizontal className="size-4" aria-hidden />}>
                  {adjust ? 'Usar o perfil do cadastro' : 'Ajustar para esta visita'}
                </Button>
              }
            />
            {adjust && (
              <div className="p-5">
                <AccessibilityEditor value={acc} onChange={setAcc} ageYears={p.ageYears} />
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="xl" loading={saving} icon={<ClipboardPlus className="size-7" aria-hidden />}>
              Criar atendimento
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

export default function NewAttendancePage() {
  return (
    <Suspense>
      <NewAttendanceInner />
    </Suspense>
  );
}
