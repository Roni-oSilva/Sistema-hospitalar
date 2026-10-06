'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { UserPlus } from 'lucide-react';
import { PatientSearch } from '@/components/patient-search';
import { Button, PageHeader } from '@/components/ui';

function PatientsInner() {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <>
      <PageHeader
        title="Pacientes"
        description="Pesquise por nome, CPF, CNS, número do prontuário, telefone ou data de nascimento."
        actions={
          <Button size="lg" onClick={() => router.push('/recepcao/pacientes/novo')} icon={<UserPlus className="size-5" aria-hidden />}>
            Cadastrar paciente
          </Button>
        }
      />
      <PatientSearch initialQuery={params.get('q') ?? ''} onNew={(q) => router.push(`/recepcao/pacientes/novo?nome=${encodeURIComponent(/\d/.test(q) ? '' : q)}`)} />
    </>
  );
}

export default function PatientsPage() {
  return (
    <Suspense>
      <PatientsInner />
    </Suspense>
  );
}
