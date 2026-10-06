'use client';

import { VITAL_LIMITS, vitalsSchema } from '@hospital/shared';
import { Input, cx } from './ui';

export interface VitalsDraft {
  systolic: string;
  diastolic: string;
  heartRate: string;
  respiratoryRate: string;
  spo2: string;
  temperatureC: string;
  glucose: string;
  weightKg: string;
  heightCm: string;
  painScale: string;
}

export const emptyVitals = (): VitalsDraft => ({ systolic: '', diastolic: '', heartRate: '', respiratoryRate: '', spo2: '', temperatureC: '', glucose: '', weightKg: '', heightCm: '', painScale: '' });
export const vitalsHasValue = (v: VitalsDraft): boolean => Object.values(v).some((x) => x.trim() !== '');

/** Valida com o mesmo schema da API (faixas de plausibilidade). Devolve payload ou erros por campo. */
export function parseVitals(v: VitalsDraft): { ok: true; data: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const r = vitalsSchema.safeParse(v);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? 'systolic');
    if (!errors[k]) errors[k] = i.message;
  }
  return { ok: false, errors };
}

function Num({ id, label, unit, value, onChange, error, disabled, decimal, width = 'w-full', hint }: { id: string; label: string; unit?: string; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean; decimal?: boolean; width?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode={decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={value}
          disabled={disabled}
          invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d,.]/g : /\D/g, ''))}
          className={cx('tabular pr-14 font-mono text-lg', width)}
        />
        {unit && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-3">{unit}</span>}
      </div>
      {error ? (
        <p id={`${id}-err`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Campos de sinais vitais — nenhum é obrigatório individualmente (registre o que for aferido). */
export function VitalsForm({ value, onChange, errors = {}, disabled }: { value: VitalsDraft; onChange: (v: VitalsDraft) => void; errors?: Record<string, string>; disabled?: boolean }) {
  const set = (k: keyof VitalsDraft) => (v: string) => onChange({ ...value, [k]: v });
  return (
    // colunas pela largura do cartão (container query), não da janela: o formulário vive numa coluna estreita
    <div className="@container flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 @xl:grid-cols-3 @4xl:grid-cols-4">
        <fieldset className="col-span-2 flex flex-col gap-1 @xl:col-span-1">
          <legend className="mb-1 text-sm font-semibold text-ink-2">Pressão arterial (mmHg)</legend>
          <div className="flex items-center gap-2">
            <Input aria-label="Pressão sistólica" placeholder="120" inputMode="numeric" className="tabular font-mono text-lg" value={value.systolic} disabled={disabled} invalid={Boolean(errors.systolic)} onChange={(e) => set('systolic')(e.target.value.replace(/\D/g, ''))} />
            <span className="text-2xl text-ink-3" aria-hidden>/</span>
            <Input aria-label="Pressão diastólica" placeholder="80" inputMode="numeric" className="tabular font-mono text-lg" value={value.diastolic} disabled={disabled} invalid={Boolean(errors.diastolic)} onChange={(e) => set('diastolic')(e.target.value.replace(/\D/g, ''))} />
          </div>
          {(errors.systolic || errors.diastolic) && (
            <p className="text-sm text-danger" role="alert">
              {errors.systolic ?? errors.diastolic}
            </p>
          )}
        </fieldset>
        <Num id="v-fc" label="Freq. cardíaca" unit="bpm" value={value.heartRate} onChange={set('heartRate')} error={errors.heartRate} disabled={disabled} />
        <Num id="v-fr" label="Freq. respiratória" unit="irpm" value={value.respiratoryRate} onChange={set('respiratoryRate')} error={errors.respiratoryRate} disabled={disabled} />
        <Num id="v-spo2" label="Saturação O₂" unit="%" value={value.spo2} onChange={set('spo2')} error={errors.spo2} disabled={disabled} />
        <Num id="v-temp" label="Temperatura" unit="°C" decimal value={value.temperatureC} onChange={set('temperatureC')} error={errors.temperatureC} disabled={disabled} hint="Ex.: 36,8" />
        <Num id="v-glic" label="Glicemia" unit="mg/dL" value={value.glucose} onChange={set('glucose')} error={errors.glucose} disabled={disabled} />
        <Num id="v-peso" label="Peso" unit="kg" decimal value={value.weightKg} onChange={set('weightKg')} error={errors.weightKg} disabled={disabled} />
        <Num id="v-alt" label="Altura" unit="cm" decimal value={value.heightCm} onChange={set('heightCm')} error={errors.heightCm} disabled={disabled} />
      </div>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-semibold text-ink-2">
          Escala de dor <span className="font-normal text-ink-3">(0 = sem dor · 10 = pior dor imaginável)</span>
        </legend>
        <div role="radiogroup" aria-label="Escala de dor de 0 a 10" className="flex flex-wrap gap-1.5">
          {Array.from({ length: 11 }, (_, n) => {
            const selected = value.painScale === String(n);
            return (
              <label key={n} className={cx('grid size-11 cursor-pointer place-items-center rounded-[var(--radius-control)] border font-mono text-lg font-bold focus-within:ring-[3px] focus-within:ring-accent/70', selected ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface hover:bg-sunken')}>
                <input type="radio" name="pain" className="sr-only" checked={selected} onChange={() => set('painScale')(String(n))} />
                {n}
              </label>
            );
          })}
          {value.painScale !== '' && (
            <button type="button" className="ml-1 h-11 rounded px-3 text-sm text-ink-3 underline" onClick={() => set('painScale')('')}>
              limpar
            </button>
          )}
        </div>
        {errors.painScale && <p className="mt-1 text-sm text-danger">{errors.painScale}</p>}
      </fieldset>
      <p className="text-xs text-ink-3">
        Faixas aceitas (para evitar erro de digitação): SpO₂ {VITAL_LIMITS.spo2[0]}–{VITAL_LIMITS.spo2[1]}%, temperatura {VITAL_LIMITS.temperatureC[0]}–{VITAL_LIMITS.temperatureC[1]} °C, FC {VITAL_LIMITS.heartRate[0]}–{VITAL_LIMITS.heartRate[1]} bpm.
      </p>
    </div>
  );
}
