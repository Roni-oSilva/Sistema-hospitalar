import { z } from 'zod';
import { RISK_LEVELS } from '../enums';
import { emptyToUndefined, expectedVersionSchema, optionalText, requiredText } from './common';

/** Todos os campos são opcionais: nem todo atendimento precisa de todos os sinais vitais. */
const optionalNumber = (min: number, max: number, label: string, integer = false) =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : typeof v === 'string' ? Number(v.replace(',', '.')) : v),
    (integer ? z.number().int(`${label}: informe um número inteiro.`) : z.number({ invalid_type_error: `${label}: valor inválido.` }))
      .min(min, `${label}: valor mínimo ${min}.`)
      .max(max, `${label}: valor máximo ${max}.`)
      .optional(),
  );

/** Faixas de plausibilidade (repetidas como CHECK no banco). Valores fora delas são quase certamente erro de digitação. */
export const VITAL_LIMITS = {
  systolic: [30, 300],
  diastolic: [20, 200],
  heartRate: [10, 300],
  respiratoryRate: [3, 90],
  spo2: [30, 100],
  temperatureC: [25, 45],
  glucose: [10, 1500],
  weightKg: [0.3, 500],
  heightCm: [20, 260],
  painScale: [0, 10],
} as const;

export const vitalsSchema = z
  .object({
    systolic: optionalNumber(...VITAL_LIMITS.systolic, 'Pressão sistólica', true),
    diastolic: optionalNumber(...VITAL_LIMITS.diastolic, 'Pressão diastólica', true),
    heartRate: optionalNumber(...VITAL_LIMITS.heartRate, 'Frequência cardíaca', true),
    respiratoryRate: optionalNumber(...VITAL_LIMITS.respiratoryRate, 'Frequência respiratória', true),
    spo2: optionalNumber(...VITAL_LIMITS.spo2, 'Saturação de oxigênio', true),
    temperatureC: optionalNumber(...VITAL_LIMITS.temperatureC, 'Temperatura'),
    glucose: optionalNumber(...VITAL_LIMITS.glucose, 'Glicemia', true),
    weightKg: optionalNumber(...VITAL_LIMITS.weightKg, 'Peso'),
    heightCm: optionalNumber(...VITAL_LIMITS.heightCm, 'Altura'),
    painScale: optionalNumber(...VITAL_LIMITS.painScale, 'Escala de dor', true),
  })
  .superRefine((v, ctx) => {
    if ((v.systolic === undefined) !== (v.diastolic === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['systolic'], message: 'Informe a pressão arterial completa (sistólica e diastólica).' });
    } else if (v.systolic !== undefined && v.diastolic !== undefined && v.systolic <= v.diastolic) {
      ctx.addIssue({ code: 'custom', path: ['systolic'], message: 'A pressão sistólica deve ser maior que a diastólica.' });
    }
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['systolic'], message: 'Informe ao menos um sinal vital.' });
    }
  });
export type VitalsInput = z.infer<typeof vitalsSchema>;

export const triageDataSchema = z.object({
  chiefComplaint: optionalText(1000, 'Queixa principal'),
  symptoms: optionalText(2000, 'Sintomas'),
  symptomOnset: optionalText(200, 'Início dos sintomas'),
  allergies: optionalText(500, 'Alergias'),
  medicationsInUse: optionalText(1000, 'Medicamentos em uso'),
  notes: optionalText(2000, 'Observações'),
});
export type TriageDataInput = z.infer<typeof triageDataSchema>;

export const saveTriageSchema = triageDataSchema.extend({
  expectedVersion: expectedVersionSchema,
  /** Obrigatória quando a triagem já foi finalizada (correção antes de o médico assumir). */
  correctionReason: z.preprocess(emptyToUndefined, z.string().min(5, 'Informe o motivo da correção.').max(300).optional()),
});
export type SaveTriageInput = z.infer<typeof saveTriageSchema>;

export const classifySchema = z.object({
  level: z.enum(RISK_LEVELS, { errorMap: () => ({ message: 'Selecione o nível de classificação de risco.' }) }),
  observation: optionalText(500, 'Observação'),
  /** Obrigatório em reclassificação (já existe classificação). */
  reason: z.preprocess(emptyToUndefined, z.string().min(5, 'Informe o motivo da alteração.').max(300).optional()),
});
export type ClassifyInput = z.infer<typeof classifySchema>;

export const releaseTriageSchema = z.object({
  reason: requiredText(3, 200, 'Motivo'),
});
