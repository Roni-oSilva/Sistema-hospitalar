'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Save, Trash2, UserCheck } from 'lucide-react';
import { SEXES, SEX_LABELS, UF_LIST, calcAge, createPatientSchema, updatePatientSchema } from '@hospital/shared';
import { ApiError, post, put } from '@/lib/api';
import { brDateToIso, isoToBrDate, maskCepInput, maskCnsInput, maskCpfInput, maskDateInput, maskPhoneInput } from '@/lib/masks';
import type { PatientDetail } from '@/lib/types';
import { AccessibilityEditor, fromAccessibility, toAccessibilityInput, type AccessibilityValue } from './accessibility-editor';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Select } from './ui';

interface Phone {
  type: 'TELEFONE' | 'CELULAR';
  number: string;
}
interface FormState {
  fullName: string;
  socialName: string;
  cpf: string;
  cns: string;
  rg: string;
  birthDate: string; // dd/mm/aaaa
  sex: string;
  nationality: string;
  birthplace: string;
  motherName: string;
  phones: Phone[];
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  hasGuardian: boolean;
  guardianName: string;
  guardianCpf: string;
  guardianRelationship: string;
  guardianPhone: string;
  accessibility: AccessibilityValue;
}

function initialState(p?: PatientDetail | null, initialName = ''): FormState {
  return {
    fullName: p?.fullName ?? initialName,
    socialName: p?.socialName ?? '',
    cpf: p?.cpf && !p.documentsMasked ? maskCpfInput(p.cpf) : '',
    cns: p?.cns && !p.documentsMasked ? maskCnsInput(p.cns) : '',
    rg: p?.rg && !p.documentsMasked ? p.rg : '',
    birthDate: isoToBrDate(p?.birthDate),
    sex: p?.sex ?? '',
    nationality: p?.nationality ?? 'Brasileira',
    birthplace: p?.birthplace ?? '',
    motherName: p?.motherName ?? '',
    phones: p?.phones.length ? p.phones.map((x) => ({ type: x.type, number: maskPhoneInput(x.number) })) : [{ type: 'CELULAR', number: '' }],
    street: p?.address?.street ?? '',
    number: p?.address?.number ?? '',
    complement: p?.address?.complement ?? '',
    neighborhood: p?.address?.neighborhood ?? '',
    city: p?.address?.city ?? 'Ulianópolis',
    state: p?.address?.state ?? 'PA',
    zipCode: p?.address?.zipCode ? maskCepInput(p.address.zipCode) : '',
    hasGuardian: Boolean(p?.guardian),
    guardianName: p?.guardian?.name ?? '',
    guardianCpf: p?.guardian?.cpf ? maskCpfInput(p.guardian.cpf) : '',
    guardianRelationship: p?.guardian?.relationship ?? '',
    guardianPhone: p?.guardian?.phone ? maskPhoneInput(p.guardian.phone) : '',
    accessibility: fromAccessibility(p?.accessibility),
  };
}

interface DuplicateInfo {
  kind: 'document' | 'likely';
  message: string;
  patientId?: string;
  candidates?: { id: string; fullName: string; recordNumber: string; motherName: string | null }[];
}

/**
 * Cadastro/edição do paciente. Validação com o MESMO schema da API (mensagens idênticas e imediatas).
 * Só nome, nascimento e sexo são obrigatórios — o resto não trava a recepção.
 */
export function PatientForm({ patient, onSaved, initialName }: { patient?: PatientDetail | null; onSaved: (p: PatientDetail, next: 'attend' | 'stay') => void; initialName?: string }) {
  const editing = Boolean(patient);
  const [s, setS] = useState<FormState>(() => initialState(patient, initialName));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [saving, setSaving] = useState<null | 'attend' | 'stay'>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const birthIso = brDateToIso(s.birthDate);
  const ageYears = useMemo(() => (birthIso ? calcAge(birthIso).years : null), [birthIso]);

  function payload(confirmNotDuplicate: boolean) {
    return {
      fullName: s.fullName,
      socialName: s.socialName,
      // em edição com documentos mascarados (sem permissão), os campos ficam vazios e não são enviados
      cpf: s.cpf,
      cns: s.cns,
      rg: s.rg,
      birthDate: birthIso || s.birthDate,
      sex: s.sex || undefined,
      nationality: s.nationality,
      birthplace: s.birthplace,
      motherName: s.motherName,
      phones: s.phones.filter((p) => p.number.replace(/\D/g, '')).map((p) => ({ type: p.type, number: p.number })),
      address: { street: s.street, number: s.number, complement: s.complement, neighborhood: s.neighborhood, city: s.city, state: s.state, zipCode: s.zipCode },
      guardian: s.hasGuardian ? { name: s.guardianName, cpf: s.guardianCpf, relationship: s.guardianRelationship, phone: s.guardianPhone } : null,
      accessibility: toAccessibilityInput(s.accessibility),
      confirmNotDuplicate,
      ...(editing ? { expectedVersion: patient!.version } : {}),
    };
  }

  async function submit(next: 'attend' | 'stay', confirmNotDuplicate = false) {
    setFormError(null);
    setDuplicate(null);
    const body = payload(confirmNotDuplicate);
    const parsed = (editing ? updatePatientSchema : createPatientSchema).safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = i.path.join('.');
        if (!errs[k]) errs[k] = i.message;
      }
      setErrors(errs);
      setFormError('Revise os campos destacados.');
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setErrors({});
    setSaving(next);
    try {
      const saved = editing ? await put<PatientDetail>(`/patients/${patient!.id}`, body) : await post<PatientDetail>('/patients', body);
      onSaved(saved, next);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'DUPLICATE_DOCUMENT') setDuplicate({ kind: 'document', message: e.message, patientId: e.details.patientId as string });
        else if (e.code === 'POSSIBLE_DUPLICATE') setDuplicate({ kind: 'likely', message: e.message, candidates: e.details.candidates as DuplicateInfo['candidates'] });
        else {
          setErrors(e.fieldErrors);
          setFormError(e.message);
        }
      } else setFormError('Não foi possível salvar o cadastro. Tente novamente.');
    } finally {
      setSaving(null);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(editing ? 'stay' : 'attend');
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError && <Alert tone="danger" title="Não foi possível salvar">{formError}</Alert>}
      {duplicate?.kind === 'document' && (
        <Alert
          tone="warn"
          title="Paciente já cadastrado"
          actions={
            <Link href={`/recepcao/pacientes/${duplicate.patientId}`} className="inline-flex h-11 items-center rounded-full bg-accent px-5 font-semibold text-white hover:bg-accent-hover">
              Abrir o cadastro existente
            </Link>
          }
        >
          {duplicate.message} Para não duplicar, use o cadastro existente.
        </Alert>
      )}
      {duplicate?.kind === 'likely' && (
        <Alert tone="warn" title="Possível cadastro duplicado">
          <p>{duplicate.message}</p>
          <ul className="my-2 flex flex-col gap-2">
            {duplicate.candidates?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface px-3 py-2">
                <span>
                  <strong>{c.fullName}</strong> · Prontuário {c.recordNumber}
                  {c.motherName ? ` · Mãe: ${c.motherName}` : ''}
                </span>
                <Link href={`/recepcao/pacientes/${c.id}`} className="font-semibold text-accent underline">
                  É esta pessoa — abrir
                </Link>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" onClick={() => void submit(editing ? 'stay' : 'attend', true)} icon={<UserCheck className="size-4" aria-hidden />}>
            Não é a mesma pessoa — confirmar novo cadastro
          </Button>
        </Alert>
      )}

      <Card>
        <CardHeader title="Dados pessoais" description="Obrigatórios: nome completo, data de nascimento e sexo." />
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Nome completo" required error={errors.fullName} className="md:col-span-2">
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} autoFocus={!editing} autoComplete="off" value={s.fullName} onChange={(e) => set('fullName', e.target.value)} />}
          </Field>
          <Field label="Nome social" hint="Como a pessoa prefere ser chamada" error={errors.socialName} className="md:col-span-2">
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} autoComplete="off" value={s.socialName} onChange={(e) => set('socialName', e.target.value)} />}
          </Field>
          <Field label="Data de nascimento" required hint={ageYears !== null ? `${ageYears} anos` : 'dd/mm/aaaa'} error={errors.birthDate}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="numeric" placeholder="dd/mm/aaaa" value={s.birthDate} onChange={(e) => set('birthDate', maskDateInput(e.target.value))} />}
          </Field>
          <Field label="Sexo" required error={errors.sex}>
            {(f) => (
              <Select id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.sex} onChange={(e) => set('sex', e.target.value)}>
                <option value="">Selecione…</option>
                {SEXES.map((x) => (
                  <option key={x} value={x}>
                    {SEX_LABELS[x]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="CPF" error={errors.cpf} hint={patient?.documentsMasked ? 'Documento oculto para o seu perfil' : undefined}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="numeric" placeholder="000.000.000-00" value={s.cpf} disabled={patient?.documentsMasked} onChange={(e) => set('cpf', maskCpfInput(e.target.value))} />}
          </Field>
          <Field label="CNS (Cartão SUS)" error={errors.cns}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="numeric" placeholder="000 0000 0000 0000" value={s.cns} disabled={patient?.documentsMasked} onChange={(e) => set('cns', maskCnsInput(e.target.value))} />}
          </Field>
          <Field label="RG" error={errors.rg}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.rg} disabled={patient?.documentsMasked} onChange={(e) => set('rg', e.target.value)} />}
          </Field>
          <Field label="Nome da mãe" error={errors.motherName}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} autoComplete="off" value={s.motherName} onChange={(e) => set('motherName', e.target.value)} />}
          </Field>
          <Field label="Nacionalidade" error={errors.nationality}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.nationality} onChange={(e) => set('nationality', e.target.value)} />}
          </Field>
          <Field label="Naturalidade" hint="Município/UF de nascimento" error={errors.birthplace}>
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.birthplace} onChange={(e) => set('birthplace', e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Contato e endereço" />
        <div className="flex flex-col gap-4 p-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-2">Telefones</legend>
            {s.phones.map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <Select
                  aria-label={`Tipo do telefone ${i + 1}`}
                  className="w-40"
                  value={p.type}
                  onChange={(e) => set('phones', s.phones.map((x, j) => (j === i ? { ...x, type: e.target.value as Phone['type'] } : x)))}
                >
                  <option value="CELULAR">Celular</option>
                  <option value="TELEFONE">Telefone</option>
                </Select>
                <div className="min-w-48 flex-1">
                  <Input
                    aria-label={`Número do telefone ${i + 1}`}
                    invalid={Boolean(errors[`phones.${i}.number`])}
                    inputMode="tel"
                    placeholder="(94) 90000-0000"
                    value={p.number}
                    onChange={(e) => set('phones', s.phones.map((x, j) => (j === i ? { ...x, number: maskPhoneInput(e.target.value) } : x)))}
                  />
                  {errors[`phones.${i}.number`] && <p className="mt-1 text-sm text-danger">{errors[`phones.${i}.number`]}</p>}
                </div>
                {s.phones.length > 1 && (
                  <Button variant="ghost" aria-label={`Remover telefone ${i + 1}`} onClick={() => set('phones', s.phones.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" aria-hidden />} />
                )}
              </div>
            ))}
            {s.phones.length < 4 && (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => set('phones', [...s.phones, { type: 'TELEFONE', number: '' }])} icon={<Plus className="size-4" aria-hidden />}>
                Adicionar telefone
              </Button>
            )}
          </fieldset>
          <div className="grid gap-4 md:grid-cols-6">
            <Field label="Endereço" className="md:col-span-3" error={errors['address.street']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.street} onChange={(e) => set('street', e.target.value)} />}
            </Field>
            <Field label="Número" error={errors['address.number']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.number} onChange={(e) => set('number', e.target.value)} />}
            </Field>
            <Field label="Complemento" className="md:col-span-2" error={errors['address.complement']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.complement} onChange={(e) => set('complement', e.target.value)} />}
            </Field>
            <Field label="Bairro" className="md:col-span-2" error={errors['address.neighborhood']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />}
            </Field>
            <Field label="Município" className="md:col-span-2" error={errors['address.city']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.city} onChange={(e) => set('city', e.target.value)} />}
            </Field>
            <Field label="UF" error={errors['address.state']}>
              {(f) => (
                <Select id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.state} onChange={(e) => set('state', e.target.value)}>
                  <option value="">—</option>
                  {UF_LIST.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="CEP" error={errors['address.zipCode']}>
              {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="numeric" value={s.zipCode} onChange={(e) => set('zipCode', maskCepInput(e.target.value))} />}
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Responsável / acompanhante" description="Quando necessário (crianças, pessoas que precisam de acompanhante)." />
        <div className="flex flex-col gap-4 p-5">
          <Checkbox label="Informar responsável ou acompanhante" checked={s.hasGuardian} onChange={(v) => set('hasGuardian', v)} />
          {s.hasGuardian && (
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Nome" required className="md:col-span-2" error={errors['guardian.name']}>
                {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} value={s.guardianName} onChange={(e) => set('guardianName', e.target.value)} />}
              </Field>
              <Field label="Parentesco" required error={errors['guardian.relationship']}>
                {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} placeholder="Ex.: mãe, filho" value={s.guardianRelationship} onChange={(e) => set('guardianRelationship', e.target.value)} />}
              </Field>
              <Field label="CPF" error={errors['guardian.cpf']}>
                {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="numeric" value={s.guardianCpf} onChange={(e) => set('guardianCpf', maskCpfInput(e.target.value))} />}
              </Field>
              <Field label="Telefone" error={errors['guardian.phone']}>
                {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} inputMode="tel" value={s.guardianPhone} onChange={(e) => set('guardianPhone', maskPhoneInput(e.target.value))} />}
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Acessibilidade e características do paciente" />
        <div className="p-5">
          <AccessibilityEditor
            value={s.accessibility}
            onChange={(v) => set('accessibility', v)}
            ageYears={ageYears}
            errors={{ disabilityType: errors['accessibility.disabilityType'], otherNeedDescription: errors['accessibility.otherNeedDescription'] }}
          />
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-3 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {editing ? (
          <Button type="submit" size="lg" loading={saving === 'stay'} icon={<Save className="size-5" aria-hidden />}>
            Salvar alterações
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="lg" loading={saving === 'stay'} onClick={() => void submit('stay')} icon={<Save className="size-5" aria-hidden />}>
              Só salvar cadastro
            </Button>
            <Button type="submit" size="lg" loading={saving === 'attend'} icon={<UserCheck className="size-5" aria-hidden />}>
              Salvar e iniciar atendimento
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
