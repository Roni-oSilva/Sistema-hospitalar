import type { AccessibilityFlag, AccessibilityNeed, DisabilityType, RiskLevel, Sex } from '@hospital/shared';
import { ACCESSIBILITY_FLAG_META, calcAge, effectiveAccessibilityFlags, formatAge, hasLegalPriority } from '@hospital/shared';

export const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const toDateOnlyDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

interface AccessibilityRow {
  flags: AccessibilityFlag[];
  disabilityType: DisabilityType | null;
  needs: AccessibilityNeed[];
  otherNeedDescription: string | null;
}

export function accessibilityDto(row: AccessibilityRow | null | undefined, birthDate: Date | string) {
  const bd = typeof birthDate === 'string' ? birthDate : dateOnly(birthDate);
  const flags = row?.flags ?? [];
  const effective = effectiveAccessibilityFlags(flags, bd);
  return {
    flags,
    effectiveFlags: effective,
    badges: effective.map((f) => ({ code: f, label: ACCESSIBILITY_FLAG_META[f].short })),
    disabilityType: row?.disabilityType ?? null,
    needs: row?.needs ?? [],
    otherNeedDescription: row?.otherNeedDescription ?? null,
    legalPriority: hasLegalPriority(effective),
  };
}

export interface PatientBasicRow {
  id: string;
  recordNumber: number;
  fullName: string;
  socialName: string | null;
  birthDate: Date;
  sex: Sex;
}

/** Identificação mínima do paciente (filas, listas). Sem documentos. */
export function patientBasic(p: PatientBasicRow, ref: Date = new Date()) {
  const bd = dateOnly(p.birthDate);
  const age = calcAge(bd, ref);
  return {
    id: p.id,
    recordNumber: String(p.recordNumber).padStart(6, '0'),
    fullName: p.fullName,
    socialName: p.socialName,
    displayName: p.socialName ? `${p.socialName} (${p.fullName})` : p.fullName,
    birthDate: bd,
    sex: p.sex,
    ageYears: age.years,
    ageLabel: formatAge(age),
  };
}

export const decimalToNumber = (v: { toNumber(): number } | number | null | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === 'number' ? v : v.toNumber();

export type { RiskLevel };
