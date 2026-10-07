'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ACCESS_EVENTS, dayRange } from '@hospital/shared';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, Input, LoadError, PageHeader, Select, Spinner, cx } from '@/components/ui';

interface AuditItem {
  id: string;
  createdAt: string;
  username: string | null;
  sector: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  attendanceCode: string | null;
  patientId: string | null;
  changes: { fields?: string[]; diff?: Record<string, { from: unknown; to: unknown }> } | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}
interface AccessItem {
  id: string;
  createdAt: string;
  event: string;
  success: boolean;
  username: string | null;
  reason: string | null;
  ip: string | null;
}
interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

const ACCESS_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Login',
  LOGIN_FAILED: 'Falha de login',
  LOGIN_BLOCKED: 'Bloqueio',
  LOGOUT: 'Saída',
  SESSION_EXPIRED: 'Sessão expirada',
  PASSWORD_CHANGED: 'Troca de senha',
  PASSWORD_RESET: 'Senha redefinida',
};

/** Trilha de auditoria (somente leitura — o banco não permite alterar nem apagar registros). */
export default function AuditPage() {
  const [tab, setTab] = useState<'acoes' | 'acessos'>('acoes');
  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê, quando, onde e em qual atendimento. Registros imutáveis. Consultar a auditoria também é registrado." />
      <div role="tablist" className="mb-6 flex gap-2">
        {[
          ['acoes', 'Ações no sistema'],
          ['acessos', 'Acessos (login)'],
        ].map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k as 'acoes' | 'acessos')} className={cx('h-11 rounded-full border px-5 font-semibold', tab === k ? 'border-accent bg-accent text-white' : 'border-line bg-surface')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'acoes' ? <Actions /> : <Access />}
    </>
  );
}

function periodQuery(date: string) {
  if (!date) return {};
  const { start, end } = dayRange(date);
  return { from: start.toISOString(), to: end.toISOString() };
}

function Actions() {
  const [draft, setDraft] = useState({ username: '', action: '', attendanceCode: '', date: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin', 'audit', filters, page],
    queryFn: () => api<Page<AuditItem>>('/admin/audit-logs', { query: { username: filters.username, action: filters.action, attendanceCode: filters.attendanceCode, ...periodQuery(filters.date), page, pageSize: 50 } }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 border-b border-line p-5 md:grid-cols-5 md:items-end">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Usuário
          <Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Ação contém
          <Input value={draft.action} placeholder="ex.: CLINICAL, LOGIN, CANCEL" onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Atendimento
          <Input value={draft.attendanceCode} placeholder="ATD-2026-000001" onChange={(e) => setDraft({ ...draft, attendanceCode: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Dia
          <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </label>
        <Button type="submit" icon={<Search className="size-4" aria-hidden />}>
          Filtrar
        </Button>
      </form>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data ? (
        <LoadError title="Não foi possível carregar a auditoria" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs font-bold tracking-wider text-ink-3 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3">Data/hora</th>
                  <th scope="col" className="px-3 py-3">Usuário</th>
                  <th scope="col" className="px-3 py-3">Ação</th>
                  <th scope="col" className="px-3 py-3">Registro</th>
                  <th scope="col" className="px-3 py-3">Alteração</th>
                  <th scope="col" className="px-3 py-3">Origem</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-0">
                    <td className="tabular px-5 py-2 font-mono whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      {r.username ?? '—'}
                      {r.sector && <span className="block text-xs text-ink-3">{r.sector}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{r.action}</td>
                    <td className="px-3 py-2">
                      {r.entityType}
                      {r.attendanceCode && <span className="tabular block font-mono text-xs">{r.attendanceCode}</span>}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      {r.changes?.fields?.length ? <span>Campos: {r.changes.fields.join(', ')}</span> : null}
                      {r.changes?.diff && (
                        <details>
                          <summary className="cursor-pointer text-accent">ver valores</summary>
                          <pre className="mt-1 overflow-x-auto rounded bg-sunken p-2 text-xs whitespace-pre-wrap">{JSON.stringify(r.changes.diff, null, 2)}</pre>
                        </details>
                      )}
                      {r.metadata && Object.keys(r.metadata).length > 0 && <span className="block text-xs text-ink-3">{JSON.stringify(r.metadata)}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-3">
                      {r.ip}
                      {r.userAgent && <span className="block max-w-48 truncate" title={r.userAgent}>{r.userAgent}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={q.data.total} page={page} pageSize={q.data.pageSize} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function Access() {
  const [event, setEvent] = useState('');
  const [username, setUsername] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin', 'access', event, username, page], queryFn: () => api<Page<AccessItem>>('/admin/access-logs', { query: { event, username, page, pageSize: 50 } }) });
  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-5 md:grid-cols-3 md:items-end">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Evento
          <Select value={event} onChange={(e) => (setEvent(e.target.value), setPage(1))}>
            <option value="">Todos</option>
            {ACCESS_EVENTS.map((e) => (
              <option key={e} value={e}>
                {ACCESS_LABELS[e]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
          Usuário
          <Input value={username} onChange={(e) => (setUsername(e.target.value), setPage(1))} />
        </label>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data ? (
        <LoadError title="Não foi possível carregar a auditoria" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs font-bold tracking-wider text-ink-3 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3">Data/hora</th>
                  <th scope="col" className="px-3 py-3">Evento</th>
                  <th scope="col" className="px-3 py-3">Usuário informado</th>
                  <th scope="col" className="px-3 py-3">Detalhe</th>
                  <th scope="col" className="px-3 py-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="tabular px-5 py-2 font-mono">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', r.success ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>{ACCESS_LABELS[r.event] ?? r.event}</span>
                    </td>
                    <td className="px-3 py-2">{r.username ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-3">{r.reason ?? ''}</td>
                    <td className="tabular px-3 py-2 font-mono text-xs">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={q.data.total} page={page} pageSize={q.data.pageSize} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function Pager({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
      <span className="text-ink-3">
        {total} registro(s) · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}
