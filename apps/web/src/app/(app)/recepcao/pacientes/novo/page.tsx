'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PatientForm } from '@/components/patient-form';
import { PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';

function NewPatientInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader title="Novo paciente" description="Preencha o essencial agora; os demais dados podem ser completados depois." />
      <PatientForm
        initialName={params.get('nome') ?? ''}
        onSaved={(p, next) => {
          qc.invalidateQueries({ queryKey: ['patient-search'] });
          toast.show('ok', 'Paciente cadastrado', `${p.fullName} · Prontuário ${p.recordNumber}`);
          router.push(next === 'attend' ? `/recepcao/atendimento/novo?patientId=${p.id}` : `/recepcao/pacientes/${p.id}`);
        }}
      />
    </>
  );
}

export default function NewPatientPage() {
  return (
    <Suspense>
      <NewPatientInner />
    </Suspense>
  );
}
