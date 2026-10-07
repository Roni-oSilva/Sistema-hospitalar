'use client';

import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { errorMessage } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

// ───────────────────────────── Botões ─────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white shadow-[0_8px_20px_-10px_rgb(15_61_125/0.7)] hover:bg-accent-hover disabled:bg-ink-3 disabled:shadow-none',
  accent: 'bg-lime text-ink shadow-[0_8px_20px_-12px_rgb(30_160_70/0.8)] hover:bg-lime-hover',
  secondary: 'bg-surface text-accent border border-accent/35 hover:border-accent hover:bg-accent-soft',
  ghost: 'bg-transparent text-ink-2 hover:bg-accent-soft hover:text-accent',
  danger: 'bg-surface text-danger border border-danger/60 hover:bg-danger-soft',
};
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[0.95rem] gap-2',
  lg: 'h-14 px-6 text-lg gap-2.5',
  xl: 'h-20 px-8 text-2xl gap-3',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  kbd?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, kbd, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap transition-[background-color,border-color,box-shadow] select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.1em] animate-spin" aria-hidden /> : icon}
      {children}
      {kbd && <Kbd className="ml-1 hidden lg:inline-flex">{kbd}</Kbd>}
    </button>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx('inline-flex items-center rounded border border-current/30 px-1.5 py-0.5 font-mono text-[0.7em] font-medium opacity-80', className)}>
      {children}
    </kbd>
  );
}

// ───────────────────────────── Campos ─────────────────────────────

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Rótulo + controle + dica + erro, com aria ligado corretamente (leitores de tela leem o erro). */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        {required && <span className="sr-only"> (obrigatório)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-center gap-1 text-sm font-medium text-danger" role="alert">
          <XCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const controlBase =
  'w-full rounded-[var(--radius-control)] border bg-surface/95 text-ink placeholder:text-ink-3/80 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30 focus-visible:border-accent disabled:bg-sunken disabled:text-ink-3';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; inputSize?: 'md' | 'lg' }>(function Input(
  { invalid, inputSize = 'md', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(controlBase, inputSize === 'lg' ? 'h-14 px-4 text-lg' : 'h-11 px-3', invalid ? 'border-danger' : 'border-line-strong', className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cx(controlBase, 'px-3 py-2.5 leading-relaxed', invalid ? 'border-danger' : 'border-line-strong', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ invalid, className, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cx(controlBase, 'h-11 px-3', invalid ? 'border-danger' : 'border-line-strong', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, description, checked, onChange, disabled, name }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors',
        checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface/90 hover:border-line-strong',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input id={id} name={name} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="text-xs text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

// ───────────────────────────── Superfícies ─────────────────────────────

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('glass rounded-[var(--radius-card)]', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, description, actions, icon, level = 2 }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>{icon}</span>}
        <div>
          <H className="text-lg font-bold text-ink">{title}</H>
          {description && <p className="text-sm text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-2 inline-flex rounded-full bg-lime px-3 py-1 text-xs font-bold tracking-wider text-ink uppercase">{eyebrow}</p>}
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-tight text-ink uppercase">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'info' | 'ok' | 'warn' | 'danger';
const TONE: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-accent/30 bg-accent-soft text-ink', Icon: Info },
  ok: { cls: 'border-ok/30 bg-ok-soft text-ink', Icon: CheckCircle2 },
  warn: { cls: 'border-warn/30 bg-warn-soft text-ink', Icon: AlertTriangle },
  danger: { cls: 'border-danger/40 bg-danger-soft text-ink', Icon: XCircle },
};

export function Alert({ tone = 'info', title, children, actions, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  const { cls, Icon } = TONE[tone];
  const iconColor = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-accent';
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-[var(--radius-control)] border px-4 py-3', cls, className)}>
      <Icon className={cx('mt-0.5 size-5 shrink-0', iconColor)} aria-hidden />
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-sm text-ink-2">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <span className="text-ink-3" aria-hidden>{icon}</span>}
      <p className="text-lg font-semibold text-ink-2">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Carregando…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2 py-10 text-ink-3', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Stat({ label, value, tone, icon }: { label: string; value: number | string; tone?: 'default' | 'accent' | 'warn' | 'ok'; icon?: ReactNode }) {
  const toneCls = tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : tone === 'accent' ? 'text-accent' : 'text-accent';
  return (
    <div className="glass flex flex-col gap-1.5 rounded-[var(--radius-card)] px-5 py-4">
      <span className="flex items-center gap-2 text-xs font-semibold tracking-wider text-ink-3 uppercase">
        {icon}
        {label}
      </span>
      <span className={cx('tabular font-display text-4xl leading-none font-extrabold', toneCls)}>{value}</span>
    </div>
  );
}

/** Rótulo/valor compacto para fichas de dados. */
export function DataItem({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className={cx('text-ink', mono && 'tabular font-mono')}>{value ?? '—'}</dd>
    </div>
  );
}

/** Falha ao carregar uma tela que ainda não tem dados: mensagem clara e "Tentar novamente" (nunca girar para sempre). */
export function LoadError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <Alert
      tone="danger"
      title={title}
      actions={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      }
    >
      {error ? errorMessage(error) : 'Tente novamente.'}
    </Alert>
  );
}
