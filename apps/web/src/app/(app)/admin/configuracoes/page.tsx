'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PERMISSIONS, RISK_LEVELS, type RiskLevel } from '@hospital/shared';
import { ApiError, api, post, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Room } from '@/lib/types';
import { RiskBadge } from '@/components/clinical';
import { Button, Card, CardHeader, Checkbox, Input, LoadError, PageHeader, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';

interface Setting {
  key: string;
  description: string;
  value: unknown;
  defaultValue: unknown;
  updatedAt: string | null;
}
interface Sector {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  _count: { rooms: number; users: number };
}

const TABS = ['Parâmetros', 'Consultórios', 'Setores'] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Parâmetros');
  return (
    <>
      <PageHeader title="Configurações" description="Parâmetros do sistema, consultórios e setores. Toda alteração é auditada." />
      <div role="tablist" className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-11 rounded-full border px-5 font-semibold', tab === t ? 'border-accent bg-accent text-white' : 'border-line bg-surface')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Parâmetros' && <Parameters />}
      {tab === 'Consultórios' && <Rooms />}
      {tab === 'Setores' && <Sectors />}
    </>
  );
}

function Parameters() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<Setting[]>('/admin/settings') });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <LoadError title="Não foi possível abrir as configurações" error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      {q.data.map((s) => (
        <SettingEditor key={s.key} setting={s} writable={can(PERMISSIONS.SETTINGS_WRITE)} />
      ))}
    </div>
  );
}

function SettingEditor({ setting, writable }: { setting: Setting; writable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState<unknown>(setting.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(value) !== JSON.stringify(setting.value);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await put(`/admin/settings/${setting.key}`, { value });
      toast.show('ok', 'Parâmetro salvo');
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  let editor: React.ReactNode;
  if (typeof setting.defaultValue === 'boolean') {
    editor = <Checkbox label={value ? 'Ativado' : 'Desativado'} checked={Boolean(value)} disabled={!writable} onChange={setValue} />;
  } else if (typeof setting.defaultValue === 'number') {
    editor = <Input type="number" className="w-40" value={String(value ?? '')} disabled={!writable} onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))} />;
  } else if (typeof setting.defaultValue === 'object' && setting.defaultValue) {
    const obj = (value ?? {}) as Record<RiskLevel, number>;
    editor = (
      <div className="grid gap-3 sm:grid-cols-5">
        {RISK_LEVELS.map((l) => (
          <label key={l} className="flex flex-col gap-1">
            <RiskBadge level={l} size="sm" className="self-start" />
            <span className="flex items-center gap-1">
              <Input type="number" min={0} className="w-24" value={String(obj[l] ?? '')} disabled={!writable} onChange={(e) => setValue({ ...obj, [l]: Number(e.target.value) })} />
              <span className="text-sm text-ink-3">min</span>
            </span>
          </label>
        ))}
      </div>
    );
  } else {
    editor = <Input className="max-w-xl" value={String(value ?? '')} disabled={!writable} onChange={(e) => setValue(e.target.value)} />;
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{setting.description}</p>
          <span className="tabular font-mono text-xs text-ink-3">
            {setting.key}
            {setting.updatedAt ? ` · alterado em ${fmtDateTime(setting.updatedAt)}` : ' · padrão'}
          </span>
        </div>
        {editor}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {writable && changed && (
          <div className="flex gap-2">
            <Button size="sm" loading={saving} onClick={() => void save()}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setValue(setting.value)}>
              Desfazer
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Rooms() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const rooms = useQuery({ queryKey: ['rooms', 'all'], queryFn: () => api<Room[]>('/rooms') });
  const sectors = useQuery({ queryKey: ['admin', 'sectors'], queryFn: () => api<Sector[]>('/admin/sectors') });
  const [name, setName] = useState('');
  const writable = can(PERMISSIONS.FACILITIES_WRITE);
  const consultorios = sectors.data?.find((s) => s.code === 'CONSULTORIOS');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.show('ok', ok);
      qc.invalidateQueries({ queryKey: ['rooms'] });
    } catch (e) {
      toast.show('error', 'Não foi possível salvar', e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : undefined);
    }
  };

  return (
    <Card>
      <CardHeader title="Consultórios" description="Os médicos escolhem em qual consultório estão ao chamar pacientes." />
      {writable && consultorios && (
        <form
          className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => post('/admin/rooms', { name, sectorId: consultorios.id, isActive: true }), 'Consultório criado').then(() => setName(''));
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink-2">Novo consultório</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Consultório 04" className="w-72" />
          </label>
          <Button type="submit" icon={<Plus className="size-4" aria-hidden />} disabled={name.trim().length < 2}>
            Adicionar
          </Button>
        </form>
      )}
      <ul className="divide-y divide-line">
        {rooms.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className={cx('font-semibold', !r.isActive && 'text-ink-3 line-through')}>{r.name}</span>
            {r.occupiedBy && <span className="text-sm text-ink-3">em uso por {r.occupiedBy}</span>}
            {writable && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const n = window.prompt('Novo nome do consultório:', r.name);
                    if (n && n.trim() !== r.name) void run(() => put(`/admin/rooms/${r.id}`, { name: n.trim() }), 'Consultório renomeado');
                  }}
                >
                  Renomear
                </Button>
                <Button size="sm" variant={r.isActive ? 'danger' : 'secondary'} onClick={() => void run(() => put(`/admin/rooms/${r.id}`, { isActive: !r.isActive }), r.isActive ? 'Consultório desativado' : 'Consultório ativado')}>
                  {r.isActive ? 'Desativar' : 'Ativar'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Sectors() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'sectors'], queryFn: () => api<Sector[]>('/admin/sectors') });
  const writable = can(PERMISSIONS.FACILITIES_WRITE);
  return (
    <Card>
      <CardHeader title="Setores" description="Usados para identificar onde cada ação foi registrada (auditoria e linha do tempo)." />
      <ul className="divide-y divide-line">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="font-semibold">{s.name}</span>
            <span className="tabular font-mono text-xs text-ink-3">{s.code}</span>
            <span className="text-sm text-ink-3">
              {s._count.users} usuário(s) · {s._count.rooms} consultório(s)
            </span>
            {writable && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  const n = window.prompt('Nome do setor:', s.name);
                  if (!n || n.trim() === s.name) return;
                  try {
                    await put(`/admin/sectors/${s.id}`, { name: n.trim(), isActive: s.isActive });
                    toast.show('ok', 'Setor atualizado');
                    qc.invalidateQueries({ queryKey: ['admin', 'sectors'] });
                  } catch (e) {
                    toast.show('error', 'Não foi possível salvar', e instanceof ApiError ? e.message : undefined);
                  }
                }}
              >
                Renomear
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
