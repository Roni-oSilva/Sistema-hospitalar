import { z } from 'zod';
import { OUTCOMES } from '../enums';
import { emptyToUndefined, expectedVersionSchema, optionalText, requiredText, uuidSchema } from './common';

export const callPatientSchema = z.object({
  roomId: uuidSchema,
});
export type CallPatientInput = z.infer<typeof callPatientSchema>;

export const saveConsultationSchema = z.object({
  chiefComplaint: optionalText(1000, 'Queixa principal'),
  history: optionalText(8000, 'História / evolução'),
  examination: optionalText(8000, 'Exame / avaliação'),
  conduct: optionalText(4000, 'Conduta'),
  expectedVersion: expectedVersionSchema,
  /** Obrigatória após a finalização (correção versionada). */
  correctionReason: z.preprocess(emptyToUndefined, z.string().min(5, 'Informe o motivo da correção.').max(300).optional()),
});
export type SaveConsultationInput = z.infer<typeof saveConsultationSchema>;

/** CID-10 opcional (ex.: I20.9). O catálogo oficial entra em módulo futuro; hoje o médico informa código e/ou descrição. */
const cidSchema = z.preprocess(
  (v) => (typeof v === 'string' ? emptyToUndefined(v.toUpperCase()) : v),
  z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'CID-10 inválido (ex.: I20.9).').optional(),
);

export const addDiagnosisSchema = z.object({
  code: cidSchema,
  description: requiredText(2, 300, 'Descrição do diagnóstico'),
  isPrimary: z.boolean().default(false),
});
export type AddDiagnosisInput = z.infer<typeof addDiagnosisSchema>;

export const removeDiagnosisSchema = z.object({
  reason: requiredText(5, 300, 'Motivo da remoção'),
});

export const prescriptionItemSchema = z.object({
  medication: requiredText(2, 200, 'Medicamento'),
  dose: requiredText(1, 100, 'Dose'),
  route: requiredText(1, 60, 'Via'),
  frequency: requiredText(1, 100, 'Frequência'),
  duration: requiredText(1, 100, 'Duração'),
  notes: optionalText(500, 'Observação'),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

export const cancelPrescriptionItemSchema = z.object({
  reason: requiredText(5, 300, 'Motivo do cancelamento'),
});

export const finishConsultationSchema = z.object({
  outcome: z.enum(OUTCOMES, { errorMap: () => ({ message: 'Selecione o desfecho do atendimento.' }) }),
  finalNotes: optionalText(2000, 'Observações finais'),
  /** Se informado, impede finalizar sobre uma versão desatualizada (conflito de edição). */
  expectedVersion: expectedVersionSchema.optional(),
});
export type FinishConsultationInput = z.infer<typeof finishConsultationSchema>;

export const addMedicalNoteSchema = z.object({
  content: requiredText(3, 4000, 'Complemento'),
});

export const cancelByDoctorSchema = z.object({
  reason: requiredText(5, 300, 'Motivo do cancelamento'),
});
