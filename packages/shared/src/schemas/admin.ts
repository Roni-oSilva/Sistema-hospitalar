import { z } from 'zod';
import { ACCESS_EVENTS, SECTOR_CODES } from '../enums';
import { ALL_PERMISSIONS } from '../permissions';
import { passwordSchema } from './auth';
import { emptyToUndefined, optionalText, requiredText, uuidSchema } from './common';

const usernameSchema = z
  .string({ required_error: 'Informe o usuário.' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, 'Usuário: 3 a 40 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).');

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: requiredText(3, 200, 'Nome completo'),
  email: z.preprocess(emptyToUndefined, z.string().email('E-mail inválido.').max(200).optional()),
  professionalRegister: optionalText(40, 'Registro profissional (CRM/COREN)'),
  roleCodes: z.array(z.string().min(2).max(40)).min(1, 'Selecione ao menos um perfil.'),
  sectorId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  /** Senha temporária: o usuário é obrigado a trocá-la no primeiro acesso. */
  temporaryPassword: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: requiredText(3, 200, 'Nome completo'),
  email: z.preprocess(emptyToUndefined, z.string().email('E-mail inválido.').max(200).optional()),
  professionalRegister: optionalText(40, 'Registro profissional (CRM/COREN)'),
  roleCodes: z.array(z.string().min(2).max(40)).min(1, 'Selecione ao menos um perfil.'),
  sectorId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  isActive: z.boolean(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  temporaryPassword: passwordSchema,
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

export const createRoomSchema = z.object({
  name: requiredText(2, 60, 'Nome do consultório'),
  sectorId: uuidSchema,
  isActive: z.boolean().default(true),
});
export const updateRoomSchema = createRoomSchema.partial();

export const updateSectorSchema = z.object({
  name: requiredText(2, 80, 'Nome do setor'),
  isActive: z.boolean(),
});
export const sectorCodeSchema = z.enum(SECTOR_CODES);

export const updateSettingSchema = z.object({
  value: z.unknown(),
});

export const auditQuerySchema = z.object({
  userId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  username: optionalText(60),
  action: optionalText(60),
  entityType: optionalText(60),
  patientId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  attendanceCode: optionalText(30),
  from: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  to: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const accessLogQuerySchema = z.object({
  event: z.preprocess(emptyToUndefined, z.enum(ACCESS_EVENTS).optional()),
  username: optionalText(60),
  from: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  to: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
