'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { PERMISSIONS } from '@hospital/shared';
import { ApiError, api, put } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, PageHeader, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';

interface RolesResponse {
  roles: { id: string; code: string; name: string; description: string | null; isSystem: boolean; users: number; permissions: string[] }[];
  permissions: { code: string; module: string; description: string }[];
}

/** Permissões que o perfil Administrador não pode perder (a API também recusa). */
const ADMIN_LOCKED = new Set<string>([PERMISSIONS.USERS_WRITE, PERMISSIONS.ROLES_WRITE, PERMISSIONS.USERS_READ, PERMISSIONS.ROLES_READ]);
const CLINICAL = new Set<string>([PERMISSIONS.TRIAGE_READ, PERMISSIONS.CONSULTATION_READ, PERMISSIONS.CLINICAL_HISTORY_READ, PERMISSIONS.PATIENTS_VIEW_DOCUMENTS]);

export default function PermissionsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api<RolesResponse>('/admin/roles') });
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const writable = can(PERMISSIONS.ROLES_WRITE);

  useEffect(() => {
    if (q.data) setMatrix(Object.fromEntries(q.data.roles.map((r) => [r.code, new Set(r.permissions)])));
  }, [q.data]);

  if (q.isLoading || !q.data) return <Spinner />;
  const modules = Array.from(new Set(q.data.permissions.map((p) => p.module)));
  const dirty = (code: string) => {
    const orig = q.data!.roles.find((r) => r.code === code)!.permissions;
    const cur = matrix[code];
    return cur && (orig.length !== cur.size || orig.some((p) => !cur.has(p)));
  };

  async function save(code: string) {
    setSaving(code);
    try {
      await put(`/admin/roles/${code}/permissions`, { permissions: [...matrix[code]] });
      toast.show('ok', 'Permissões atualizadas', 'Valem imediatamente para todos os usuários do perfil.');
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    } catch (e) {
      toast.show('error', 'Não foi possível salvar', e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHeader title="Perfis e permissões" description="Menor privilégio: dê a cada perfil apenas o necessário para a sua função." />
      <Alert tone="warn" className="mb-6" title="Cuidado com permissões clínicas">
        Permissões marcadas com “dado sensível” liberam acesso a informações de saúde ou documentos. Toda leitura clínica fica registrada na auditoria.
      </Alert>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="sticky top-16 z-10 border-b border-line bg-paper">
              <tr>
                <th scope="col" className="px-5 py-3 text-xs font-bold tracking-wider text-ink-3 uppercase">Permissão</th>
                {q.data.roles.map((r) => (
                  <th key={r.code} scope="col" className="min-w-36 px-3 py-3 text-center">
                    <span className="block font-bold">{r.name}</span>
                    <span className="block text-xs font-normal text-ink-3">{r.users} usuário(s)</span>
                    {writable && dirty(r.code) && (
                      <Button size="sm" className="mt-2" loading={saving === r.code} onClick={() => void save(r.code)}>
                        Salvar
                      </Button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {modules.map((m) => (
              <tbody key={m}>
                <tr className="bg-sunken/60">
                  <th scope="rowgroup" colSpan={q.data!.roles.length + 1} className="px-5 py-2 text-sm font-bold text-ink-2">
                    {m}
                  </th>
                </tr>
                {q.data!.permissions
                  .filter((p) => p.module === m)
                  .map((p) => (
                    <tr key={p.code} className="border-b border-line">
                      <th scope="row" className="px-5 py-2 font-normal">
                        <span className="block font-medium text-ink">{p.description}</span>
                        <span className="tabular font-mono text-xs text-ink-3">{p.code}</span>
                        {CLINICAL.has(p.code) && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">dado sensível</span>}
                      </th>
                      {q.data!.roles.map((r) => {
                        const locked = r.code === 'ADMINISTRADOR' && ADMIN_LOCKED.has(p.code);
                        const checked = matrix[r.code]?.has(p.code) ?? false;
                        return (
                          <td key={r.code} className={cx('px-3 py-2 text-center', checked && 'bg-accent-soft/50')}>
                            <label className="inline-grid size-11 cursor-pointer place-items-center">
                              <span className="sr-only">{`${p.description} para ${r.name}`}</span>
                              {locked ? (
                                <Lock className="size-4 text-ink-3" aria-label="Obrigatória para o administrador" />
                              ) : (
                                <input
                                  type="checkbox"
                                  className="size-5 accent-[var(--color-accent)]"
                                  checked={checked}
                                  disabled={!writable}
                                  onChange={(e) => {
                                    const next = new Set(matrix[r.code]);
                                    if (e.target.checked) next.add(p.code);
                                    else next.delete(p.code);
                                    setMatrix({ ...matrix, [r.code]: next });
                                  }}
                                />
                              )}
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </>
  );
}
