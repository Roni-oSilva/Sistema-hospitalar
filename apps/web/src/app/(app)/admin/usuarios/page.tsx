'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Pencil, UserPlus, Wand2 } from 'lucide-react';
import { PERMISSIONS, ROLE_CODES, ROLE_DESCRIPTIONS } from '@hospital/shared';
import { ApiError, api, post, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  professionalRegister: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  sector: { id: string; code: string; name: string } | null;
  roles: { code: string; name: string }[];
}
interface Sector {
  id: string;
  code: string;
  name: string;
}

/** Senha temporária forte (o usuário troca no primeiro acesso). */
function generatePassword(): string {
  const words = ['Rio', 'Ipe', 'Acai', 'Sol', 'Mata', 'Ponte', 'Lago', 'Serra', 'Vento', 'Folha', 'Pedra', 'Areia'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const n = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  return `${pick()}${pick()}${pick()}${n}`;
}

export default function UsersPage() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserRow[]>('/admin/users') });
  const sectors = useQuery({ queryKey: ['admin', 'sectors'], queryFn: () => api<Sector[]>('/admin/sectors') });
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [reset, setReset] = useState<{ user: UserRow; password: string } | null>(null);
  const writable = can(PERMISSIONS.USERS_WRITE);

  async function doReset() {
    if (!reset) return;
    try {
      await post(`/admin/users/${reset.user.id}/reset-password`, { temporaryPassword: reset.password });
      toast.show('ok', 'Senha redefinida', `Entregue a senha temporária a ${reset.user.fullName} pessoalmente.`);
      setReset(null);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (e) {
      toast.show('error', 'Não foi possível redefinir', e instanceof ApiError ? (e.fieldErrors.temporaryPassword ?? e.message) : undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Cada pessoa tem o seu próprio acesso. Nunca compartilhe usuários."
        actions={writable && <Button size="lg" onClick={() => setEditing('new')} icon={<UserPlus className="size-5" aria-hidden />}>Novo usuário</Button>}
      />
      {editing && <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} sectors={sectors.data ?? []} selfId={me.user.id} onDone={() => setEditing(null)} />}
      {reset && (
        <Card className="mb-6 border-accent">
          <CardHeader title={`Redefinir senha de ${reset.user.fullName}`} description="A pessoa será obrigada a criar uma nova senha no próximo acesso. As sessões abertas dela serão encerradas." />
          <div className="flex flex-wrap items-end gap-3 p-5">
            <Field label="Senha temporária">
              {(f) => <Input id={f.id} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} className="tabular w-72 font-mono" />}
            </Field>
            <Button variant="ghost" icon={<Wand2 className="size-4" aria-hidden />} onClick={() => setReset({ ...reset, password: generatePassword() })}>
              Gerar outra
            </Button>
            <Button onClick={() => void doReset()}>Redefinir</Button>
            <Button variant="ghost" onClick={() => setReset(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}
      <Card>
        {users.isLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-paper text-xs font-bold tracking-wider text-ink-3 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3">Nome</th>
                  <th scope="col" className="px-3 py-3">Perfis</th>
                  <th scope="col" className="px-3 py-3">Setor</th>
                  <th scope="col" className="px-3 py-3">Situação</th>
                  <th scope="col" className="px-3 py-3">Último acesso</th>
                  <th scope="col" className="px-3 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id} className={cx('border-b border-line last:border-0', !u.isActive && 'text-ink-3')}>
                    <td className="px-5 py-3">
                      <p className="font-semibold">{u.fullName}</p>
                      <p className="text-sm text-ink-3">
                        {u.username}
                        {u.professionalRegister ? ` · ${u.professionalRegister}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3">{u.roles.map((r) => r.name).join(', ')}</td>
                    <td className="px-3 py-3">{u.sector?.name ?? '—'}</td>
                    <td className="px-3 py-3">
                      <span className={cx('rounded-full px-2.5 py-1 text-sm font-semibold', !u.isActive ? 'bg-sunken' : u.locked ? 'bg-danger-soft text-danger' : u.mustChangePassword ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
                        {!u.isActive ? 'Inativo' : u.locked ? 'Bloqueado (tentativas)' : u.mustChangePassword ? 'Troca de senha pendente' : 'Ativo'}
                      </span>
                    </td>
                    <td className="tabular px-3 py-3 font-mono text-sm">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'nunca'}</td>
                    <td className="px-3 py-3">
                      {writable && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(u)}>
                            Editar
                          </Button>
                          <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setReset({ user: u, password: generatePassword() })}>
                            Senha
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<LogOut className="size-4" aria-hidden />}
                            onClick={async () => {
                              const r = await post<{ revoked: number }>(`/admin/users/${u.id}/revoke-sessions`);
                              toast.show('ok', 'Sessões encerradas', `${r.revoked} sessão(ões) de ${u.fullName}.`);
                            }}
                          >
                            Sessões
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function UserForm({ user, sectors, selfId, onDone }: { user: UserRow | null; sectors: Sector[]; selfId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    username: user?.username ?? '',
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    professionalRegister: user?.professionalRegister ?? '',
    sectorId: user?.sector?.id ?? '',
    roleCodes: user?.roles.map((r) => r.code) ?? [],
    isActive: user?.isActive ?? true,
    temporaryPassword: user ? '' : generatePassword(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setError(null);
    try {
      if (user) {
        await put(`/admin/users/${user.id}`, { fullName: f.fullName, email: f.email, professionalRegister: f.professionalRegister, sectorId: f.sectorId, roleCodes: f.roleCodes, isActive: f.isActive });
        toast.show('ok', 'Usuário atualizado');
      } else {
        await post('/admin/users', { username: f.username, fullName: f.fullName, email: f.email, professionalRegister: f.professionalRegister, sectorId: f.sectorId, roleCodes: f.roleCodes, temporaryPassword: f.temporaryPassword });
        toast.show('ok', 'Usuário criado', `Entregue a senha temporária pessoalmente: ${f.temporaryPassword}`);
      }
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (err.code !== 'VALIDATION_ERROR') setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6 border-accent">
      <CardHeader title={user ? `Editar ${user.fullName}` : 'Novo usuário'} />
      <form onSubmit={submit} className="grid gap-4 p-5 md:grid-cols-3" noValidate>
        {error && <Alert tone="danger" className="md:col-span-3">{error}</Alert>}
        <Field label="Usuário (login)" required error={errors.username} hint="ex.: maria.souza">
          {(x) => <Input id={x.id} aria-describedby={x.describedBy} invalid={x.invalid} value={f.username} disabled={Boolean(user)} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />}
        </Field>
        <Field label="Nome completo" required error={errors.fullName} className="md:col-span-2">
          {(x) => <Input id={x.id} invalid={x.invalid} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}
        </Field>
        <Field label="E-mail" error={errors.email}>
          {(x) => <Input id={x.id} invalid={x.invalid} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </Field>
        <Field label="Registro profissional" hint="CRM, COREN…" error={errors.professionalRegister}>
          {(x) => <Input id={x.id} aria-describedby={x.describedBy} invalid={x.invalid} value={f.professionalRegister} onChange={(e) => setF({ ...f, professionalRegister: e.target.value })} />}
        </Field>
        <Field label="Setor" error={errors.sectorId}>
          {(x) => (
            <Select id={x.id} value={f.sectorId} onChange={(e) => setF({ ...f, sectorId: e.target.value })}>
              <option value="">—</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="md:col-span-3">
          <legend className="mb-2 text-sm font-semibold text-ink-2">Perfis</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_CODES.map((r) => (
              <Checkbox
                key={r}
                label={ROLE_DESCRIPTIONS[r].name}
                description={ROLE_DESCRIPTIONS[r].description}
                checked={f.roleCodes.includes(r)}
                disabled={user?.id === selfId && r === 'ADMINISTRADOR'}
                onChange={(v) => setF({ ...f, roleCodes: v ? [...f.roleCodes, r] : f.roleCodes.filter((x) => x !== r) })}
              />
            ))}
          </div>
          {errors.roleCodes && <p className="mt-1 text-sm text-danger">{errors.roleCodes}</p>}
        </fieldset>
        {user ? (
          <Checkbox label="Usuário ativo" description="Desativar encerra imediatamente todas as sessões. O histórico é preservado." checked={f.isActive} disabled={user.id === selfId} onChange={(v) => setF({ ...f, isActive: v })} />
        ) : (
          <Field label="Senha temporária" required error={errors.temporaryPassword} hint="Troca obrigatória no primeiro acesso.">
            {(x) => <Input id={x.id} aria-describedby={x.describedBy} invalid={x.invalid} className="tabular font-mono" value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} />}
          </Field>
        )}
        <div className="flex items-end gap-2 md:col-span-3">
          <Button type="submit" loading={saving}>
            {user ? 'Salvar' : 'Criar usuário'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
