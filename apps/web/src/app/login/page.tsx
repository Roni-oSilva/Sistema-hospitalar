'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LockKeyhole, LogIn } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { homeFor } from '@/lib/session';
import type { Me } from '@/lib/types';
import { Alert, Button, Field, Input } from '@/components/ui';
import { LogoMark } from '@/components/logo';

const REASONS: Record<string, { tone: 'info' | 'warn'; text: string }> = {
  inatividade: { tone: 'warn', text: 'Sua sessão foi encerrada por inatividade. Entre novamente para continuar.' },
  sessao: { tone: 'warn', text: 'Sua sessão expirou ou foi encerrada. Entre novamente.' },
  saiu: { tone: 'info', text: 'Você saiu do sistema com segurança.' },
};

/** Só aceita caminhos internos (evita redirecionamento aberto para sites externos). */
const safeBack = (v: string | null): string | null => (v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : null);

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const reason = REASONS[params.get('motivo') ?? ''];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const res = await api<{ mustChangePassword: boolean }>('/auth/login', { method: 'POST', body: { username, password }, silentAuth: true });
      qc.clear();
      if (res.mustChangePassword) {
        router.replace('/alterar-senha');
        return;
      }
      const me = await api<Me>('/auth/me', { silentAuth: true });
      qc.setQueryData(['me'], me);
      router.replace(safeBack(params.get('volta')) ?? homeFor(me));
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(err.code === 'VALIDATION_ERROR' ? null : err.message);
      } else setError('Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass flex w-full max-w-md flex-col gap-5 rounded-[var(--radius-card)] p-8" noValidate>
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight uppercase">Entrar</h1>
        <p className="mt-1 text-ink-3">Use o seu usuário pessoal. Não compartilhe sua senha.</p>
      </div>
      {reason && !error && <Alert tone={reason.tone}>{reason.text}</Alert>}
      {error && (
        <Alert tone="danger" title="Não foi possível entrar">
          {error}
        </Alert>
      )}
      <Field label="Usuário" error={fieldErrors.username}>
        {(f) => (
          <Input
            id={f.id}
            aria-describedby={f.describedBy}
            invalid={f.invalid}
            inputSize="lg"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
      </Field>
      <Field label="Senha" error={fieldErrors.password}>
        {(f) => (
          <div className="relative">
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              invalid={f.invalid}
              inputSize="lg"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-14"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-sunken"
              aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={show}
            >
              {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
            </button>
          </div>
        )}
      </Field>
      <Button type="submit" size="lg" loading={loading} icon={<LogIn className="size-5" aria-hidden />}>
        Entrar
      </Button>
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <LockKeyhole className="size-4" aria-hidden />
        Esqueceu a senha? Procure o administrador do sistema.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main id="conteudo" className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="brand-gradient relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex" aria-label="Apresentação">
        {/* brilhos suaves, como na referência */}
        <span className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-white/10 blur-3xl" aria-hidden />
        <span className="pointer-events-none absolute bottom-10 -left-20 size-72 rounded-full bg-lime/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-12" />
          <div className="leading-tight">
            <p className="font-display text-xl font-extrabold">HMU Atende</p>
            <p className="text-white/75">Hospital Municipal de Ulianópolis</p>
          </div>
        </div>
        <div className="relative max-w-lg">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold backdrop-blur">
            <span className="size-2 rounded-full bg-lime" aria-hidden /> Atendimento integrado
          </p>
          <p className="font-display text-[3.4rem] leading-[0.98] font-extrabold tracking-tight uppercase">
            Do balcão
            <br />
            ao <span className="text-lime">consultório</span>
          </p>
          <p className="mt-5 text-lg text-white/80">Recepção, triagem e médico trabalham sobre o mesmo atendimento — sem recadastrar, sem papel perdido, tudo registrado.</p>
        </div>
        {/* faixa com as cores dos níveis de risco — a mesma linguagem usada nas filas */}
        <div className="relative flex gap-3" aria-hidden>
          {['bg-risk-red', 'bg-risk-orange', 'bg-risk-yellow', 'bg-risk-green', 'bg-risk-blue'].map((c) => (
            <span key={c} className={`h-1.5 flex-1 rounded-full ${c}`} />
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
