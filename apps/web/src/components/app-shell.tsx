'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ClipboardList,
  FileBarChart2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorPlay,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
  CloudOff,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS, type PermissionCode } from '@hospital/shared';
import { useSession } from '@/lib/session';
import { useRealtimeStatus } from '@/lib/realtime';
import { api, post } from '@/lib/api';
import { noteServerDate } from '@/lib/clock';
import { reportOffline, reportOnline, useOfflineSince } from '@/lib/connectivity';
import { useToast } from './toast';
import { prefs } from '@/lib/prefs';
import { fmtTime } from '@/lib/format';
import type { NotificationsResponse, PublicSettings } from '@/lib/types';
import { Button, cx } from './ui';
import { LogoMark } from './logo';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  any: PermissionCode[];
  external?: boolean;
}
const P = PERMISSIONS;
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Atendimento',
    items: [
      { href: '/recepcao', label: 'Recepção', icon: UserPlus, any: [P.ATTENDANCES_CREATE] },
      { href: '/recepcao/pacientes', label: 'Pacientes', icon: Users, any: [P.PATIENTS_SEARCH] },
      { href: '/triagem', label: 'Triagem', icon: ClipboardList, any: [P.TRIAGE_QUEUE] },
      { href: '/medico', label: 'Fila médica', icon: Stethoscope, any: [P.MEDICAL_QUEUE] },
      { href: '/painel-chamada', label: 'Painel de chamada', icon: MonitorPlay, any: [P.ATTENDANCES_READ, P.MEDICAL_QUEUE], external: true },
    ],
  },
  {
    group: 'Gestão',
    items: [
      { href: '/dashboard', label: 'Indicadores', icon: LayoutDashboard, any: [P.INDICATORS_READ] },
      { href: '/admin/relatorios', label: 'Relatórios', icon: FileBarChart2, any: [P.REPORTS_READ] },
      { href: '/admin/usuarios', label: 'Usuários', icon: Users, any: [P.USERS_READ] },
      { href: '/admin/permissoes', label: 'Perfis e permissões', icon: ShieldCheck, any: [P.ROLES_READ] },
      { href: '/admin/configuracoes', label: 'Configurações', icon: Settings, any: [P.SETTINGS_READ, P.FACILITIES_WRITE] },
      { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText, any: [P.AUDIT_READ] },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/recepcao') return pathname === '/recepcao' || pathname.startsWith('/recepcao/atendimento');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { canAny } = useSession();
  const pathname = usePathname();
  const offlineSince = useOfflineSince();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public'), staleTime: 10 * 60_000 });

  const nav = (
    <nav aria-label="Navegação principal" className="flex flex-col gap-6 px-3 py-4">
      {NAV.map((g) => {
        const items = g.items.filter((i) => canAny(...i.any));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <p className="mb-1.5 px-3 text-xs font-bold tracking-wider text-white/65 uppercase">{g.group}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => {
                const active = !i.external && isActive(pathname, i.href);
                const Icon = i.icon;
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      target={i.external ? '_blank' : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={(e) => {
                        // sem conexão, trocar de tela levaria à página de erro do navegador e o que está na tela se perderia
                        if (offlineSince === null) return;
                        e.preventDefault();
                        toast.show('error', 'Sem conexão com o servidor', 'Continue nesta tela. Assim que a conexão voltar, você pode trocar de tela.');
                      }}
                      className={cx(
                        'flex min-h-11 items-center gap-3 rounded-full px-4 font-semibold transition-colors',
                        active ? 'bg-lime text-ink shadow-[0_8px_18px_-10px_rgb(94_240_124/0.9)]' : 'text-white/85 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      <span className="flex-1">{i.label}</span>
                      {i.external && <span className="sr-only">(abre em nova aba)</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      {/* barra lateral */}
      <aside className={cx('brand-gradient fixed inset-y-0 left-0 z-40 w-[15.5rem] overflow-y-auto text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <LogoMark className="size-10" />
          <div className="leading-tight">
            <p className="font-display text-lg font-extrabold tracking-tight">HMU Atende</p>
            <p className="text-xs text-white/65">{settings.data?.hospitalName ?? 'Hospital Municipal de Ulianópolis'}</p>
          </div>
          <button type="button" className="ml-auto rounded p-2 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        <ConnectivityWatcher />
        <OfflineBanner />
        <IdleWarning />
        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/80 bg-white/70 px-4 shadow-[0_6px_24px_-18px_rgb(15_61_125/0.5)] backdrop-blur-md sm:px-6 lg:px-8">
      <button type="button" className="rounded p-2 hover:bg-sunken lg:hidden" onClick={onMenu} aria-label="Abrir menu">
        <Menu className="size-6" aria-hidden />
      </button>
      <ConnectionPill />
      <div className="ml-auto flex items-center gap-2">
        <Notifications />
        <UserMenu />
      </div>
    </header>
  );
}

function ConnectionPill() {
  const status = useRealtimeStatus();
  const offlineSince = useOfflineSince();
  if (offlineSince !== null) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-danger-soft px-3 py-1 text-sm font-semibold text-danger" role="status">
        <CloudOff className="size-4" aria-hidden />
        Sem conexão com o servidor
      </span>
    );
  }
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-lime-soft px-3 py-1 text-sm font-semibold text-ok" role="status">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#1fa14a]" />
        </span>
        <Wifi className="size-4" aria-hidden />
        Tempo real ativo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1 text-sm font-semibold text-warn" role="status">
      <WifiOff className="size-4" aria-hidden />
      {status === 'connecting' ? 'Conectando…' : 'Sem tempo real — atualizando a cada 15 s'}
    </span>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationsResponse>('/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `Avisos: ${unread} não lidos` : 'Avisos'}
        className="relative grid size-11 place-items-center rounded-full bg-white text-accent shadow-sm hover:bg-accent-soft"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="tabular absolute top-1 right-1 grid min-w-5 place-items-center rounded-full bg-lime px-1 font-mono text-[0.7rem] font-bold text-ink ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-float)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-bold">Avisos</p>
            {unread > 0 && (
              <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => readAll.mutate()}>
                Marcar todos como lidos
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="px-4 py-6 text-center text-ink-3">Nenhum aviso recente.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id} className={cx('border-b border-line px-4 py-3 last:border-0', n.unread && 'bg-accent-soft/60')}>
                <p className="flex items-start justify-between gap-2 font-semibold">
                  <span>{n.title}</span>
                  <time className="tabular shrink-0 font-mono text-xs text-ink-3">{fmtTime(n.createdAt)}</time>
                </p>
                <p className="text-sm text-ink-2">{n.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<'md' | 'lg' | 'xl'>('md');
  const [device, setDevice] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setScale(prefs.textScale());
    setDevice(prefs.deviceLabel() ?? '');
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const initials = me.user.fullName
    .replace(/\(.*?\)/g, '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-3 rounded-full bg-white py-1 pr-4 pl-1 shadow-sm hover:bg-accent-soft">
        <span className="grid size-9 place-items-center rounded-full bg-accent font-display font-bold text-white ring-2 ring-lime" aria-hidden>
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{me.user.fullName}</span>
          <span className="block text-xs text-ink-3">{me.user.roles.map((r) => r.name).join(', ')}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--shadow-float)]">
          <div className="px-3 py-2">
            <p className="font-semibold">{me.user.fullName}</p>
            <p className="text-sm text-ink-3">
              {me.user.username}
              {me.user.professionalRegister ? ` · ${me.user.professionalRegister}` : ''}
            </p>
          </div>
          <div className="border-t border-line px-3 py-3">
            <p id="scale-label" className="mb-2 text-sm font-semibold text-ink-2">
              Tamanho do texto
            </p>
            <div role="radiogroup" aria-labelledby="scale-label" className="grid grid-cols-3 gap-1">
              {(['md', 'lg', 'xl'] as const).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={scale === s}
                  onClick={() => {
                    prefs.setTextScale(s);
                    setScale(s);
                  }}
                  className={cx('h-11 rounded-[var(--radius-control)] border font-bold', scale === s ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-sunken')}
                  style={{ fontSize: `${0.9 + i * 0.2}rem` }}
                >
                  A{'+'.repeat(i)}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line px-3 py-3">
            <label htmlFor="device-label" className="mb-1 block text-sm font-semibold text-ink-2">
              Identificação deste computador
            </label>
            <input
              id="device-label"
              value={device}
              maxLength={40}
              placeholder="Ex.: RECEPÇÃO-01"
              onChange={(e) => {
                setDevice(e.target.value);
                prefs.setDeviceLabel(e.target.value.trim() || null);
              }}
              className="h-11 w-full rounded-[var(--radius-control)] border border-line-strong px-3"
            />
            <p className="mt-1 text-xs text-ink-3">Registrada junto aos atendimentos criados aqui.</p>
          </div>
          <div className="flex flex-col border-t border-line pt-1">
            <Link href="/alterar-senha" className="flex min-h-11 items-center gap-3 rounded px-3 hover:bg-sunken">
              <KeyRound className="size-4" aria-hidden /> Alterar senha
            </Link>
            <button
              type="button"
              onClick={() =>
                void logout().then((ok) => {
                  if (!ok) toast.show('error', 'Não foi possível sair', 'Sem conexão com o servidor: a sessão continua aberta. Tente sair de novo quando a conexão voltar.');
                })
              }
              className="flex min-h-11 items-center gap-3 rounded px-3 text-left font-semibold text-danger hover:bg-danger-soft">
              <LogOut className="size-4" aria-hidden /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Aviso nos últimos 2 minutos antes de a sessão expirar por inatividade. */
function IdleWarning() {
  const { idleSecondsLeft, keepAlive } = useSession();
  const offlineSince = useOfflineSince();
  if (idleSecondsLeft > 120) return null;
  // sem conexão não dá para confirmar a sessão: a faixa de conexão já explica o que fazer
  if (offlineSince !== null) return null;
  const m = Math.floor(idleSecondsLeft / 60);
  const s = String(idleSecondsLeft % 60).padStart(2, '0');
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-b border-warn/40 bg-warn-soft px-4 py-2 text-ink">
      <span className="font-semibold">
        Sua sessão vai expirar por inatividade em <span className="tabular font-mono">{m}:{s}</span>.
      </span>
      <Button size="sm" variant="primary" onClick={() => void keepAlive()}>
        Continuar conectado
      </Button>
    </div>
  );
}

/**
 * Enquanto o servidor não responde, confere sozinho a cada 5 s (sem recarregar a tela). Quando volta, atualiza o que
 * falhou e avisa. Usa /api/health, que não renova nem depende da sessão.
 */
function ConnectivityWatcher() {
  const offlineSince = useOfflineSince();
  const qc = useQueryClient();
  const toast = useToast();
  const wasOffline = useRef(false);

  useEffect(() => {
    const onOffline = () => reportOffline(); // o próprio computador perdeu a rede (cabo/Wi‑Fi)
    const onOnline = () => void probe();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (offlineSince === null) return;
    const t = setInterval(() => void probe(), 5_000);
    return () => clearInterval(t);
  }, [offlineSince]);

  useEffect(() => {
    if (offlineSince !== null) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    toast.show('ok', 'Conexão com o servidor restabelecida', 'Os dados desta tela foram atualizados. Confira e salve o que estiver pendente.');
    void qc.invalidateQueries({ predicate: (query) => query.state.status === 'error' });
    void qc.invalidateQueries({ type: 'active' });
  }, [offlineSince, qc, toast]);

  return null;
}

async function probe(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  const sentAt = Date.now();
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
    if (res.ok) {
      noteServerDate(res.headers.get('date'), sentAt, Date.now());
      reportOnline();
    }
  } catch {
    /* continua sem conexão; tenta de novo no próximo intervalo */
  } finally {
    clearTimeout(timer);
  }
}

/** Faixa fixa e clara quando o servidor do hospital não responde (rede local caiu, cabo solto, servidor reiniciando). */
function OfflineBanner() {
  const offlineSince = useOfflineSince();
  if (offlineSince === null) return null;
  return (
    <div role="alert" className="sticky top-16 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-danger/40 bg-danger-soft px-4 py-3 text-center text-ink">
      <CloudOff className="size-5 shrink-0 text-danger" aria-hidden />
      <span className="font-bold text-danger">Sem conexão com o servidor desde {fmtTime(new Date(offlineSince).toISOString())}.</span>
      <span>Não feche nem recarregue esta tela: o que você digitou continua aqui. Tentando reconectar…</span>
    </div>
  );
}
