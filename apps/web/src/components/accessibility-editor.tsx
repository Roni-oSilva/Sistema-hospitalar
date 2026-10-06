'use client';

import {
  ACCESSIBILITY_FLAGS,
  ACCESSIBILITY_FLAG_META,
  ACCESSIBILITY_NEEDS,
  ACCESSIBILITY_NEED_LABELS,
  CHILD_MAX_AGE_EXCLUSIVE,
  DISABILITY_LABELS,
  DISABILITY_TYPES,
  ELDERLY_MIN_AGE,
  type AccessibilityFlag,
  type AccessibilityInput,
  type AccessibilityNeed,
  type DisabilityType,
} from '@hospital/shared';
import { Info } from 'lucide-react';
import { AccessibilityIconFor } from './clinical';
import { Field, Input, cx } from './ui';

export type AccessibilityValue = { flags: AccessibilityFlag[]; disabilityType: DisabilityType | null; needs: AccessibilityNeed[]; otherNeedDescription: string };

export const emptyAccessibilityValue = (): AccessibilityValue => ({ flags: [], disabilityType: null, needs: [], otherNeedDescription: '' });

export function toAccessibilityInput(v: AccessibilityValue): AccessibilityInput {
  return { flags: v.flags, disabilityType: v.flags.includes('PCD') ? v.disabilityType : null, needs: v.needs, otherNeedDescription: v.otherNeedDescription || undefined };
}

export function fromAccessibility(a: { flags: AccessibilityFlag[]; disabilityType: DisabilityType | null; needs: AccessibilityNeed[]; otherNeedDescription: string | null } | null | undefined): AccessibilityValue {
  return a ? { flags: [...a.flags], disabilityType: a.disabilityType, needs: [...a.needs], otherNeedDescription: a.otherNeedDescription ?? '' } : emptyAccessibilityValue();
}

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);
}

/**
 * Perfil de acessibilidade. Lembrete visível: estas informações apoiam o atendimento e NÃO mudam a classificação de risco.
 */
export function AccessibilityEditor({ value, onChange, ageYears, errors = {}, disabled }: { value: AccessibilityValue; onChange: (v: AccessibilityValue) => void; ageYears?: number | null; errors?: Record<string, string>; disabled?: boolean }) {
  const derived = new Set<AccessibilityFlag>();
  if (ageYears !== undefined && ageYears !== null) {
    if (ageYears >= ELDERLY_MIN_AGE) derived.add('IDOSO');
    if (ageYears < CHILD_MAX_AGE_EXCLUSIVE) derived.add('CRIANCA');
  }
  const isPcd = value.flags.includes('PCD');
  const hasOther = value.flags.includes('OUTRA') || value.needs.includes('OUTRA');

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-sm text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        Estas informações orientam o apoio ao paciente (acesso, comunicação, acompanhante). Elas <strong>não</strong> alteram a classificação de risco, que é feita pela triagem.
      </p>

      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-semibold text-ink-2">Perfil de acessibilidade</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ACCESSIBILITY_FLAGS.map((f) => {
            const auto = derived.has(f);
            const checked = auto || value.flags.includes(f);
            return (
              <label
                key={f}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 transition-colors',
                  checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
                  auto && 'cursor-default',
                )}
              >
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-[var(--color-accent)]"
                  checked={checked}
                  disabled={auto || disabled}
                  onChange={(e) => onChange({ ...value, flags: toggle(value.flags, f, e.target.checked), ...(f === 'PCD' && !e.target.checked ? { disabilityType: null } : {}) })}
                />
                <AccessibilityIconFor flag={f} className="size-5 text-ink-2" />
                <span className="font-medium">
                  {ACCESSIBILITY_FLAG_META[f].label}
                  {auto && <span className="block text-xs font-normal text-ink-3">identificado pela idade</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isPcd && (
        <fieldset disabled={disabled} className="rounded-[var(--radius-card)] border border-line bg-paper p-4">
          <legend className="px-1 text-sm font-semibold text-ink-2">Pessoa com deficiência</legend>
          <p id="dtype" className="mb-2 text-sm font-semibold text-ink-2">
            Tipo de deficiência
          </p>
          <div role="radiogroup" aria-labelledby="dtype" className="mb-4 flex flex-wrap gap-2">
            {DISABILITY_TYPES.map((t) => (
              <label key={t} className={cx('flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4', value.disabilityType === t ? 'border-accent bg-accent-soft font-semibold' : 'border-line bg-surface')}>
                <input type="radio" name="disabilityType" className="accent-[var(--color-accent)]" checked={value.disabilityType === t} onChange={() => onChange({ ...value, disabilityType: t })} />
                {DISABILITY_LABELS[t]}
              </label>
            ))}
          </div>
          {errors.disabilityType && <p className="mb-2 text-sm text-danger">{errors.disabilityType}</p>}
          <p className="mb-2 text-sm font-semibold text-ink-2">Necessidades específicas</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ACCESSIBILITY_NEEDS.map((n) => (
              <label key={n} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3', value.needs.includes(n) ? 'border-accent bg-accent-soft' : 'border-line bg-surface')}>
                <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={value.needs.includes(n)} onChange={(e) => onChange({ ...value, needs: toggle(value.needs, n, e.target.checked) })} />
                {ACCESSIBILITY_NEED_LABELS[n]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {hasOther && (
        <Field label="Descreva a outra necessidade" required error={errors.otherNeedDescription}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              invalid={f.invalid}
              maxLength={300}
              value={value.otherNeedDescription}
              onChange={(e) => onChange({ ...value, otherNeedDescription: e.target.value })}
              disabled={disabled}
            />
          )}
        </Field>
      )}
    </div>
  );
}
