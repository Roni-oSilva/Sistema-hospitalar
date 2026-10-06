'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Pencil } from 'lucide-react';
import { PERMISSIONS, SEX_LABELS } from '@hospital/shared';
import { api } from '@/lib/api';
import { fmtDateOnly, fmtDateTime, fmtPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AttendanceListItem, PatientDetail } from '@/lib/types';
import { PatientForm } from '@/components/patient-form';
import { AccessibilityBadges, AccessibilityDetails, StatusBadge } from '@/components/clinical';
import { Alert, Button, Card, CardHeader, DataItem, PageHeader, Spinner } from '@/components/ui';
import { useToast } from '@/components/toast';

export default function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api<PatientDetail>(`/patients/${id}`) });
  const visits = useQuery({ queryKey: ['patient', id, 'visits'], queryFn: () => api<Pick<AttendanceListItem, 'id' | 'code' | 'status' | 'arrivedAt' | 'finishedAt' | 'reason'>[]>(`/patients/${id}/attendances`) });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Alert tone="danger">Não foi possível abrir o cadastro.</Alert>;
  const p = q.data;
  const active = visits.data?.find((v) => !['ATENDIMENTO_FINALIZADO', 'CANCELADO'].includes(v.status));

  if (editing) {
    return (
      <>
        <PageHeader title={`Editar cadastro`} description={`${p.fullName} · Prontuário ${p.recordNumber}`} actions={<Button variant="ghost" onClick={() => setEditing(false)}>Cancelar edição</Button>} />
        <PatientForm
          patient={p}
          onSaved={(saved) => {
            qc.setQueryData(['patient', id], saved);
            qc.invalidateQueries({ queryKey: ['patient-search'] });
            toast.show('ok', 'Cadastro atualizado');
            setEditing(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`Prontuário ${p.recordNumber}`}
        title={p.displayName}
        description={`${fmtDateOnly(p.birthDate)} · ${p.ageLabel} · ${SEX_LABELS[p.sex]}`}
        actions={
          <>
            {can(PERMISSIONS.PATIENTS_WRITE) && (
              <Button variant="secondary" size="lg" onClick={() => setEditing(true)} icon={<Pencil className="size-5" aria-hidden />}>
                Editar cadastro
              </Button>
            )}
            {can(PERMISSIONS.ATTENDANCES_CREATE) &&
              (active ? (
                <Link href={`/atendimentos/${active.id}`} className="inline-flex h-14 items-center rounded-full border-2 border-warn bg-warn-soft px-5 font-semibold">
                  Atendimento em andamento: {active.code}
                </Link>
              ) : (
                <Link href={`/recepcao/atendimento/novo?patientId=${p.id}`} className="inline-flex h-14 items-center gap-2 rounded-full bg-accent px-6 text-lg font-semibold text-white shadow-[0_8px_20px_-10px_rgb(15_61_125/0.7)] hover:bg-accent-hover">
                  Iniciar novo atendimento <ArrowRight className="size-5" aria-hidden />
                </Link>
              ))}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Identificação" />
            <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <DataItem label="Nome completo" value={p.fullName} />
              <DataItem label="Nome social" value={p.socialName} />
              <DataItem label="Nome da mãe" value={p.motherName} />
              <DataItem label="CPF" value={p.cpf} mono />
              <DataItem label="CNS" value={p.cns} mono />
              <DataItem label="RG" value={p.rg} mono />
              <DataItem label="Nacionalidade" value={p.nationality} />
              <DataItem label="Naturalidade" value={p.birthplace} />
              <DataItem label="Telefones" value={p.phones.length ? p.phones.map((x) => fmtPhone(x.number)).join(' · ') : null} mono />
              <DataItem
                label="Endereço"
                value={p.address ? [p.address.street, p.address.number, p.address.complement, p.address.neighborhood, p.address.city && `${p.address.city}/${p.address.state ?? ''}`].filter(Boolean).join(', ') : null}
              />
              <DataItem label="Responsável" value={p.guardian ? `${p.guardian.name} (${p.guardian.relationship})${p.guardian.phone ? ` · ${fmtPhone(p.guardian.phone)}` : ''}` : null} />
            </dl>
            {p.documentsMasked && <p className="px-5 pb-4 text-sm text-ink-3">Documentos exibidos parcialmente para o seu perfil.</p>}
          </Card>
          <Card>
            <CardHeader title="Acessibilidade" />
            <div className="p-5">
              {p.accessibility.effectiveFlags.length ? (
                <>
                  <AccessibilityBadges accessibility={p.accessibility} ageYears={p.ageYears} />
                  <AccessibilityDetails accessibility={p.accessibility} className="mt-2" />
                </>
              ) : (
                <p className="text-ink-3">Nenhuma necessidade registrada.</p>
              )}
            </div>
          </Card>
        </div>
        <Card>
          <CardHeader title="Atendimentos" description="Somente datas e situação." />
          <ul className="divide-y divide-line">
            {(visits.data ?? []).length === 0 && <li className="px-5 py-6 text-ink-3">Nenhum atendimento anterior.</li>}
            {visits.data?.map((v) => (
              <li key={v.id}>
                <Link href={`/atendimentos/${v.id}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-paper">
                  <span className="tabular font-mono text-sm font-semibold">{v.code}</span>
                  <span className="text-sm text-ink-3">{fmtDateTime(v.arrivedAt)}</span>
                  <StatusBadge status={v.status} className="self-start" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
