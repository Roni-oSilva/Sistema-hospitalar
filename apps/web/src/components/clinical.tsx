'use client';

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import {
  Accessibility as AccessibilityIcon,
  AlertOctagon,
  Ban,
  Baby,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DoorOpen,
  Eye,
  FilePlus2,
  FileText,
  Footprints,
  Hand,
  Hourglass,
  Info,
  Languages,
  Megaphone,
  MessageCircle,
  PencilLine,
  Pill,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Undo2,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  ACCESSIBILITY_FLAG_META,
  ACCESSIBILITY_NEED_LABELS,
  DISABILITY_LABELS,
  RISK_LEVELS,
  RISK_META,
  STATUS_LABELS,
  type AccessibilityFlag,
  type AttendanceStatus,
  type RiskLevel,
  type TimelineEventType,
} from '@hospital/shared';
import { cx } from './ui';
import { fmtDateTime, fmtTime } from '@/lib/format';
import type { Accessibility, TimelineEvent, Vitals } from '@/lib/types';

// ───────────────────────────── Risco: cor + forma + texto ─────────────────────────────

export const RISK_STYLE: Record<RiskLevel, { solid: string; soft: string; bar: string; text: string; ring: string }> = {
  EMERGENCIA: { solid: 'bg-risk-red text-white', soft: 'bg-risk-red-soft text-risk-red', bar: 'bg-risk-red', text: 'text-risk-red', ring: 'ring-risk-red border-risk-red' },
  MUITO_URGENTE: { solid: 'bg-risk-orange text-risk-orange-ink', soft: 'bg-risk-orange-soft text-risk-orange-edge', bar: 'bg-risk-orange', text: 'text-risk-orange-edge', ring: 'ring-risk-orange-edge border-risk-orange-edge' },
  URGENTE: { solid: 'bg-risk-yellow text-risk-yellow-ink', soft: 'bg-risk-yellow-soft text-risk-yellow-edge', bar: 'bg-risk-yellow', text: 'text-risk-yellow-edge', ring: 'ring-risk-yellow-edge border-risk-yellow-edge' },
  POUCO_URGENTE: { solid: 'bg-risk-green text-white', soft: 'bg-risk-green-soft text-risk-green', bar: 'bg-risk-green', text: 'text-risk-green', ring: 'ring-risk-green border-risk-green' },
  NAO_URGENTE: { solid: 'bg-risk-blue text-white', soft: 'bg-risk-blue-soft text-risk-blue', bar: 'bg-risk-blue', text: 'text-risk-blue', ring: 'ring-risk-blue border-risk-blue' },
};

/** Forma distinta por nível — reconhecível sem enxergar cores (daltonismo, monitor ruim, impressão P&B). */
export function RiskShape({ level, className }: { level: RiskLevel; className?: string }) {
  const shape = RISK_META[level].shape;
  return (
    <svg viewBox="0 0 20 20" className={cx('size-[1em] shrink-0', className)} aria-hidden fill="currentColor">
      {shape === 'octagon' && <polygon points="6.2,1 13.8,1 19,6.2 19,13.8 13.8,19 6.2,19 1,13.8 1,6.2" />}
      {shape === 'triangle' && <polygon points="10,1.5 19,18 1,18" />}
      {shape === 'diamond' && <polygon points="10,0.8 19.2,10 10,19.2 0.8,10" />}
      {shape === 'square' && <rect x="2" y="2" width="16" height="16" rx="1.5" />}
      {shape === 'circle' && <circle cx="10" cy="10" r="9" />}
    </svg>
  );
}

export function RiskBadge({ level, size = 'md', className }: { level: RiskLevel | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  if (!level) {
    return (
      <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs font-semibold text-ink-3', className)}>
        Não classificado
      </span>
    );
  }
  const s = RISK_STYLE[level];
  const sz = size === 'lg' ? 'px-4 py-2 text-lg gap-2' : size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-3 py-1 text-sm gap-1.5';
  return (
    <span className={cx('inline-flex items-center rounded-full font-bold tracking-wide uppercase', s.solid, sz, className)}>
      <RiskShape level={level} />
      {RISK_META[level].label}
    </span>
  );
}

/**
 * Seletor de classificação de risco. É uma ESCOLHA DO PROFISSIONAL — o sistema não sugere nem pré-seleciona.
 * Teclado: setas (padrão de radiogroup) ou teclas 1 a 5.
 */
export function RiskPicker({ value, onChange, disabled, name = 'risk' }: { value: RiskLevel | null; onChange: (l: RiskLevel) => void; disabled?: boolean; name?: string }) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = Number(e.key);
    if (n >= 1 && n <= 5 && !disabled) {
      e.preventDefault();
      onChange(RISK_LEVELS[n - 1]);
    }
  };
  return (
    // Lista vertical em colunas estreitas (lateral da triagem); 5 colunas só quando o cartão é largo.
    <div className="@container">
      <div role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onKey} className="grid gap-2 @3xl:grid-cols-5">
        <span id={`${id}-label`} className="sr-only">
          Classificação de risco (teclas 1 a 5)
        </span>
        {RISK_LEVELS.map((level, i) => {
          const selected = value === level;
          const s = RISK_STYLE[level];
          return (
            <label
              key={level}
              className={cx(
                'relative flex min-h-14 cursor-pointer items-center gap-x-3 gap-y-1 rounded-[var(--radius-card)] border-2 px-3 py-2.5 transition-shadow focus-within:ring-[3px] focus-within:ring-accent/70 @3xl:flex-col @3xl:items-start @3xl:py-3',
                selected ? cx(s.solid, 'border-transparent shadow-md') : cx('bg-surface hover:shadow-sm', 'border-line'),
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input type="radio" name={`${name}-${id}`} value={level} checked={selected} disabled={disabled} onChange={() => onChange(level)} className="sr-only" />
              <span className={cx('flex w-40 shrink-0 items-center gap-2 text-base leading-tight font-bold uppercase @3xl:w-auto @3xl:pr-5', !selected && s.text)}>
                <RiskShape level={level} className="size-5 shrink-0" />
                {RISK_META[level].label}
              </span>
              <span className={cx('text-sm leading-snug @3xl:text-xs', selected ? 'opacity-90' : 'text-ink-3')}>{RISK_META[level].description}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 @3xl:absolute @3xl:top-2 @3xl:right-2">
                {selected && <CheckCircle2 className="size-5" aria-label="selecionado" />}
                <span className={cx('font-mono text-xs', selected ? 'opacity-80' : 'text-ink-3')} aria-hidden>
                  {i + 1}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Status ─────────────────────────────

const STATUS_ICON: Record<AttendanceStatus, LucideIcon> = {
  AGUARDANDO_TRIAGEM: Clock,
  EM_TRIAGEM: ClipboardList,
  AGUARDANDO_MEDICO: Hourglass,
  EM_ATENDIMENTO: Stethoscope,
  MEDICACAO_REGISTRADA: Pill,
  ATENDIMENTO_FINALIZADO: CheckCircle2,
  CANCELADO: Ban,
};

export function StatusBadge({ status, className }: { status: AttendanceStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  const tone =
    status === 'ATENDIMENTO_FINALIZADO'
      ? 'bg-ok-soft text-ok'
      : status === 'CANCELADO'
        ? 'bg-sunken text-ink-3 line-through decoration-1'
        : status === 'EM_TRIAGEM' || status === 'EM_ATENDIMENTO' || status === 'MEDICACAO_REGISTRADA'
          ? 'bg-accent-soft text-accent'
          : 'bg-sunken text-ink-2';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold', tone, className)}>
      <Icon className="size-4" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ───────────────────────────── Acessibilidade ─────────────────────────────

function ElderlyIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden>
      <circle cx="10" cy="4.5" r="2" />
      <path d="M10 7.5c-1.4.9-2 2.7-2 4.6l1 3.4-1.2 6M10 7.5l1.4 4.8 1.1 3.2 1 5.5M10.6 10.2l4.4 1.8M16 12v9" />
    </svg>
  );
}
function PregnantIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden>
      <circle cx="11" cy="4.5" r="2" />
      <path d="M11 7.5c-1.5 0-2.5 1.5-2.5 3.5v3l1 7M11 7.5c1 0 1.8 1 2 2.2 2.2.8 3 2.6 3 4.3s-1.3 3-3.5 3l-.5 4" />
    </svg>
  );
}

const FLAG_ICON: Record<AccessibilityFlag, (p: { className?: string }) => ReactNode> = {
  PCD: (p) => <AccessibilityIcon {...p} aria-hidden />,
  IDOSO: ElderlyIcon,
  GESTANTE: PregnantIcon,
  CRIANCA: (p) => <Baby {...p} aria-hidden />,
  MOBILIDADE_REDUZIDA: (p) => <Footprints {...p} aria-hidden />,
  NECESSITA_ACOMPANHANTE: (p) => <Users {...p} aria-hidden />,
  NECESSITA_INTERPRETE: (p) => <Languages {...p} aria-hidden />,
  NECESSITA_LIBRAS: (p) => <Hand {...p} aria-hidden />,
  NECESSITA_AUXILIO_VISUAL: (p) => <Eye {...p} aria-hidden />,
  NECESSITA_AUXILIO_COMUNICACAO: (p) => <MessageCircle {...p} aria-hidden />,
  OUTRA: (p) => <Info {...p} aria-hidden />,
};

export function AccessibilityIconFor({ flag, className }: { flag: AccessibilityFlag; className?: string }) {
  const I = FLAG_ICON[flag];
  return <>{I({ className: cx('size-4', className) })}</>;
}

/**
 * Selos discretos de apoio ao atendimento. NÃO indicam gravidade (por isso usam cor neutra, não as cores de risco).
 */
export function AccessibilityBadges({ accessibility, ageYears, max, size = 'md' }: { accessibility: Accessibility; ageYears?: number; max?: number; size?: 'sm' | 'md' }) {
  const flags = accessibility.effectiveFlags;
  if (!flags.length) return null;
  const shown = max ? flags.slice(0, max) : flags;
  const rest = flags.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Acessibilidade e apoio ao atendimento">
      {shown.map((f) => (
        <li
          key={f}
          className={cx(
            'inline-flex items-center gap-1 rounded-md border border-line-strong/50 bg-sunken font-semibold text-ink-2',
            size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm',
          )}
        >
          <AccessibilityIconFor flag={f} />
          {ACCESSIBILITY_FLAG_META[f].short}
          {f === 'IDOSO' && ageYears !== undefined ? ` · ${ageYears} anos` : ''}
        </li>
      ))}
      {rest > 0 && <li className="text-xs font-semibold text-ink-3">+{rest}</li>}
    </ul>
  );
}

/** Complemento dos selos: tipo de deficiência e necessidades (ex.: "Deficiência: Física · Necessidades: Cadeira de rodas"). */
export function AccessibilityDetails({ accessibility, className }: { accessibility: Accessibility; className?: string }) {
  const parts: string[] = [];
  if (accessibility.disabilityType && accessibility.disabilityType !== 'NAO_INFORMADO') parts.push(`Deficiência: ${DISABILITY_LABELS[accessibility.disabilityType]}`);
  const needs = accessibility.needs.filter((n) => n !== 'OUTRA').map((n) => ACCESSIBILITY_NEED_LABELS[n]);
  if (accessibility.otherNeedDescription) needs.push(accessibility.otherNeedDescription);
  if (needs.length) parts.push(`Necessidades: ${needs.join(', ')}`);
  if (!parts.length) return null;
  return <p className={cx('text-sm text-ink-2', className)}>{parts.join(' · ')}</p>;
}

/** "Nega", "nenhuma", "sem alergias"… não é alerta: o destaque vermelho fica reservado para alergia de fato. */
const NO_ALLERGY = /^\s*(nega(m|do)?|nenhum[a]?|n[aã]o( possui| tem| h[aá])?|sem alergias?|nkda|ausentes?)\b[\s.!]*(alergias?( conhecidas?)?)?[\s.!]*$/i;
export const deniesAllergy = (text: string): boolean => NO_ALLERGY.test(text);

export function AllergyNote({ allergies, className }: { allergies: string | null | undefined; className?: string }) {
  if (!allergies) return null;
  if (deniesAllergy(allergies)) {
    return (
      <p className={cx('flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-sunken px-4 py-2 font-semibold text-ink-2', className)} role="note">
        <ShieldCheck className="size-5 shrink-0 text-ok" aria-hidden /> Alergias: {allergies}
      </p>
    );
  }
  return (
    <p className={cx('flex items-center gap-2 rounded-[var(--radius-control)] border-2 border-danger bg-danger-soft px-4 py-2 font-bold text-danger', className)} role="note">
      <AlertOctagon className="size-5 shrink-0" aria-hidden /> Alergias: {allergies}
    </p>
  );
}

// ───────────────────────────── Linha do tempo ─────────────────────────────

const EVENT_ICON: Record<TimelineEventType, LucideIcon> = {
  ENTRADA: DoorOpen,
  TRIAGEM_INICIADA: ClipboardList,
  TRIAGEM_DEVOLVIDA: Undo2,
  TRIAGEM_FINALIZADA: ClipboardCheck,
  CLASSIFICACAO_ALTERADA: ShieldAlert,
  ACESSIBILIDADE_ATUALIZADA: AccessibilityIcon,
  CHAMADO: Megaphone,
  RECHAMADO: BellRing,
  DEVOLVIDO_A_FILA: Undo2,
  ATENDIMENTO_INICIADO: UserRound,
  DIAGNOSTICO_REGISTRADO: FileText,
  MEDICACAO_REGISTRADA: Pill,
  REGISTRO_CORRIGIDO: PencilLine,
  COMPLEMENTO_REGISTRADO: FilePlus2,
  ATENDIMENTO_FINALIZADO: CheckCircle2,
  ATENDIMENTO_CANCELADO: Ban,
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="px-5 py-6 text-ink-3">Nenhum evento registrado.</p>;
  return (
    <ol className="relative px-5 py-4">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.type] ?? Info;
        const last = i === events.length - 1;
        const level = (e.detail?.level as RiskLevel | undefined) ?? undefined;
        return (
          <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
            {!last && <span className="absolute top-9 bottom-0 left-[4.6rem] w-px bg-line" aria-hidden />}
            <time dateTime={e.occurredAt} title={fmtDateTime(e.occurredAt)} className="tabular w-12 shrink-0 pt-1.5 text-right font-mono text-sm font-bold text-ink-2">
              {fmtTime(e.occurredAt)}
            </time>
            <span
              className={cx(
                'z-[1] grid size-9 shrink-0 place-items-center rounded-full border-2 bg-surface',
                e.type === 'ATENDIMENTO_FINALIZADO' ? 'border-ok text-ok' : e.type === 'ATENDIMENTO_CANCELADO' ? 'border-line-strong text-ink-3' : 'border-line-strong text-ink-2',
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="font-semibold text-ink">{e.label}</p>
              {e.summary && (
                <p className="mt-0.5 flex items-center gap-2 text-sm text-ink-2">
                  {level && (e.type === 'TRIAGEM_FINALIZADA' || e.type === 'CLASSIFICACAO_ALTERADA') ? <RiskBadge level={level} size="sm" /> : null}
                  <span>{level && e.type === 'TRIAGEM_FINALIZADA' ? '' : e.summary}</span>
                </p>
              )}
              {e.detail?.reason ? <p className="mt-0.5 text-sm text-ink-3">Motivo: {String(e.detail.reason)}</p> : null}
              {e.actor && (
                <p className="text-sm text-ink-3">
                  {e.actor.name}
                  {e.actor.register ? ` · ${e.actor.register}` : ''}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────────── Sinais vitais ─────────────────────────────

export function VitalsGrid({ vitals, compact }: { vitals: Vitals | null; compact?: boolean }) {
  if (!vitals) return <p className="text-ink-3">Nenhum sinal vital registrado.</p>;
  const items: { label: string; value: ReactNode; unit?: string; abbr?: string }[] = [
    { label: 'Pressão arterial', abbr: 'PA', value: vitals.bloodPressure, unit: 'mmHg' },
    { label: 'Frequência cardíaca', abbr: 'FC', value: vitals.heartRate, unit: 'bpm' },
    { label: 'Frequência respiratória', abbr: 'FR', value: vitals.respiratoryRate, unit: 'irpm' },
    { label: 'Saturação de O₂', abbr: 'SpO₂', value: vitals.spo2, unit: '%' },
    { label: 'Temperatura', abbr: 'Temp.', value: vitals.temperatureC?.toLocaleString('pt-BR', { minimumFractionDigits: 1 }), unit: '°C' },
    { label: 'Glicemia', abbr: 'Glic.', value: vitals.glucose, unit: 'mg/dL' },
    { label: 'Dor', abbr: 'Dor', value: vitals.painScale !== null ? `${vitals.painScale}/10` : null },
    { label: 'Peso', abbr: 'Peso', value: vitals.weightKg?.toLocaleString('pt-BR'), unit: 'kg' },
    { label: 'Altura', abbr: 'Alt.', value: vitals.heightCm?.toLocaleString('pt-BR'), unit: 'cm' },
    { label: 'IMC', abbr: 'IMC', value: vitals.bmi?.toLocaleString('pt-BR') },
  ].filter((i) => i.value !== null && i.value !== undefined);
  return (
    <dl className={cx('grid gap-2', compact ? 'grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]')}>
      {items.map((i) => (
        <div key={i.label} className="rounded-[var(--radius-control)] border border-white bg-accent-soft/60 px-3 py-2">
          <dt className="text-xs font-semibold text-ink-3" title={i.label}>
            <abbr title={i.label} className="no-underline">
              {i.abbr}
            </abbr>
          </dt>
          {/* a unidade quebra para a linha de baixo antes de invadir o quadro vizinho (ex.: 182/106 mmHg) */}
          <dd className="tabular flex flex-wrap items-baseline gap-x-1 font-display text-xl font-extrabold text-ink">
            <span className="whitespace-nowrap">{i.value}</span>
            {i.unit && <span className="text-xs font-medium text-ink-3">{i.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SexLabel({ sex }: { sex: string }) {
  return <>{sex === 'MASCULINO' ? 'Masculino' : sex === 'FEMININO' ? 'Feminino' : sex === 'INTERSEXO' ? 'Intersexo' : 'Não informado'}</>;
}

