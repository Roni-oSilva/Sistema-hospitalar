'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileUser, Search, UserPlus } from 'lucide-react';
import { STATUS_LABELS } from '@hospital/shared';
import { api } from '@/lib/api';
import { fmtDateOnly } from '@/lib/format';
import type { PatientSearchItem } from '@/lib/types';
import { AccessibilityBadges, SexLabel } from './clinical';
import { Alert, Button, Kbd, Spinner, cx } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Busca única e rápida: nome, CPF, CNS, nº do prontuário, telefone ou data de nascimento (dd/mm/aaaa)
 * no MESMO campo. Antes de cadastrar, a recepção sempre busca — o resultado já mostra se há atendimento em andamento.
 */
export function PatientSearch({ initialQuery = '', autoFocus = true, onNew }: { initialQuery?: string; autoFocus?: boolean; onNew?: (q: string) => void }) {
  const [q, setQ] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 300);
  const enabled = debounced.length >= 2;
  const results = useQuery({
    queryKey: ['patient-search', debounced],
    queryFn: ({ signal }) => api<PatientSearchItem[]>('/patients/search', { query: { q: debounced }, signal }),
    enabled,
    staleTime: 5_000,
  });

  // atalho "/" foca a busca (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
        <label htmlFor="patient-search" className="sr-only">
          Buscar paciente
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-5 size-6 -translate-y-1/2 text-accent" aria-hidden />
        <input
          ref={inputRef}
          id="patient-search"
          type="search"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, CPF, CNS, prontuário, telefone ou nascimento (dd/mm/aaaa)"
          aria-describedby="patient-search-hint"
          className="h-16 w-full rounded-full border-2 border-white bg-white/90 pr-16 pl-14 text-xl shadow-[var(--shadow-card)] placeholder:text-ink-3/80 focus-visible:border-accent focus-visible:ring-[4px] focus-visible:ring-lime/60 focus-visible:outline-none"
        />
        <Kbd className="absolute top-1/2 right-4 -translate-y-1/2 text-ink-3">/</Kbd>
      </form>
      <p id="patient-search-hint" className="-mt-2 text-sm text-ink-3">
        Busque sempre antes de cadastrar: o sistema não permite duplicar pacientes.
      </p>

      {enabled && results.isLoading && <Spinner label="Buscando…" />}
      {results.error && <Alert tone="danger">Não foi possível buscar agora. Tente novamente.</Alert>}
      {enabled && results.data && (
        <section aria-live="polite" aria-label="Resultados da busca">
          {results.data.length === 0 ? (
            <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 py-5">
              <div>
                <p className="text-lg font-semibold">Nenhum paciente encontrado para “{debounced}”.</p>
                <p className="text-ink-3">Confira a grafia ou busque por outro dado. Se for a primeira vez, cadastre.</p>
              </div>
              {onNew && (
                <Button size="lg" onClick={() => onNew(debounced)} icon={<UserPlus className="size-5" aria-hidden />}>
                  Cadastrar novo paciente
                </Button>
              )}
            </div>
          ) : (
            <>
              <p className="mb-2 text-sm font-semibold text-ink-3">
                {results.data.length === 1 ? '1 paciente encontrado' : `${results.data.length} pacientes encontrados`}
              </p>
              <ul className="flex flex-col gap-2">
                {results.data.map((p) => (
                  <PatientResult key={p.id} p={p} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function PatientResult({ p }: { p: PatientSearchItem }) {
  const active = p.activeAttendance;
  return (
    <li className={cx('glass flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] px-5 py-4', active && '!border-warn/60')}>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold text-ink">{p.displayName}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
          <span>
            Nascimento <strong className="tabular font-mono">{fmtDateOnly(p.birthDate)}</strong> · {p.ageLabel}
          </span>
          <span>
            <SexLabel sex={p.sex} />
          </span>
          <span>
            Prontuário <strong className="tabular font-mono">{p.recordNumber}</strong>
          </span>
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-ink-3">
          <span>CPF {p.cpfMasked ?? 'não informado'}</span>
          <span>CNS {p.cnsMasked ?? 'não informado'}</span>
          {p.phoneMasked && <span>Tel. {p.phoneMasked}</span>}
        </p>
        <div className="mt-2">
          <AccessibilityBadges accessibility={p.accessibility} ageYears={p.ageYears} size="sm" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/recepcao/pacientes/${p.id}`} aria-label={`Cadastro de ${p.displayName}`} className="inline-flex h-11 items-center gap-2 rounded-full px-4 font-semibold text-accent hover:bg-accent-soft">
          <FileUser className="size-5" aria-hidden /> Cadastro
        </Link>
        {active ? (
          <Link href={`/atendimentos/${active.id}`} className="inline-flex h-14 items-center gap-2 rounded-full border-2 border-warn bg-warn-soft px-5 font-semibold text-ink">
            Em andamento: {active.code} · {STATUS_LABELS[active.status]}
          </Link>
        ) : (
          <Link href={`/recepcao/atendimento/novo?patientId=${p.id}`} className="inline-flex h-14 items-center gap-2 rounded-full bg-accent px-6 text-lg font-semibold text-white shadow-[0_8px_20px_-10px_rgb(15_61_125/0.7)] hover:bg-accent-hover">
            Iniciar novo atendimento <ArrowRight className="size-5" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}
