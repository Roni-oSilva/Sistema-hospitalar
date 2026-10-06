import { z } from 'zod';
import { ATTENDANCE_KINDS, ATTENDANCE_STATUSES } from '../enums';
import { accessibilitySchema } from './accessibility';
import { optionalText, requiredText, uuidSchema } from './common';

export const createAttendanceSchema = z.object({
  patientId: uuidSchema,
  kind: z.enum(ATTENDANCE_KINDS).default('ATENDIMENTO'),
  /** Motivo da procura, informado pela recepção. */
  reason: optionalText(500, 'Motivo da procura'),
  /** Acessibilidade desta visita. Se omitido, usa o perfil do cadastro. */
  accessibility: accessibilitySchema.optional(),
  /** Identificador do computador/dispositivo (informado pelo navegador; apenas apoio de rastreio). */
  deviceLabel: optionalText(80, 'Dispositivo'),
});
export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;

export const cancelAttendanceSchema = z.object({
  reason: requiredText(5, 300, 'Motivo do cancelamento'),
});
export type CancelAttendanceInput = z.infer<typeof cancelAttendanceSchema>;

export const listAttendancesSchema = z.object({
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(ATTENDANCE_STATUSES)).optional(),
  ),
  /** "YYYY-MM-DD" no fuso do hospital; padrão: hoje. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: optionalText(100),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListAttendancesInput = z.infer<typeof listAttendancesSchema>;

export const updateAttendanceAccessibilitySchema = z.object({
  accessibility: accessibilitySchema,
  /** Também grava no perfil permanente do paciente (use para condições permanentes; gestação é da visita). */
  updatePatientProfile: z.boolean().default(false),
});
export type UpdateAttendanceAccessibilityInput = z.infer<typeof updateAttendanceAccessibilitySchema>;
