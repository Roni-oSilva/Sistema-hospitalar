'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@hospital/shared';
import { ApiError, api } from '@/lib/api';
import { SessionProvider, homeFor, useSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { Alert, Button, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';

function ChangePasswordForm() {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const forced = me.user.mustChangePassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (next !== confirm) {
      setErrors({ confirm: 'As senhas não conferem.' });
      return;
    }
    setLoading(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      const fresh = await api<Me>('/auth/me');
      qc.setQueryData(['me'], fresh);
      toast.show('ok', 'Senha alterada', 'As suas outras sessões foram encerradas por segurança.');
      router.replace(homeFor(fresh));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.code === 'WRONG_CURRENT_PASSWORD' ? { currentPassword: err.message } : err.fieldErrors);
        if (err.code !== 'VALIDATION_ERROR' && err.code !== 'WRONG_CURRENT_PASSWORD') setError(err.message);
      } else setError('Não foi possível alterar a senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main id="conteudo" className="grid min-h-screen place-items-center px-6 py-12">
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-8" noValidate>
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
            <KeyRound className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">{forced ? 'Crie a sua senha' : 'Alterar senha'}</h1>
            <p className="text-ink-3">{me.user.fullName}</p>
          </div>
        </div>
        {forced && <Alert tone="info">Você entrou com uma senha temporária. Para continuar, defina uma senha pessoal que só você conheça.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={forced ? 'Senha temporária' : 'Senha atual'} error={errors.currentPassword}>
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />}
        </Field>
        <Field label="Nova senha" hint={`Ao menos ${PASSWORD_MIN_LENGTH} caracteres, com letras e números. Frases longas são ótimas senhas.`} error={errors.newPassword}>
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Confirme a nova senha" error={errors.confirm}>
          {(f) => <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Salvar nova senha
        </Button>
        {!forced && (
          <Button variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
        )}
      </form>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <SessionProvider allowPendingPassword>
      <ChangePasswordForm />
    </SessionProvider>
  );
}
