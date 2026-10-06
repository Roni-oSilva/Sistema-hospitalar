import { z } from 'zod';
import { isValidCns, isValidCpf, isValidPhone, onlyDigits } from '../validators';

/** "" e espaços viram undefined, para que campos opcionais vazios do formulário não virem erro. */
export const emptyToUndefined = (v: unknown): unknown => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  return v === null ? undefined : v;
};

export const optionalText = (max: number, label = 'Texto') =>
  z.preprocess(emptyToUndefined, z.string().max(max, `${label}: no máximo ${max} caracteres.`).optional());

export const requiredText = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z
      .string({ required_error: `${label} é obrigatório.`, invalid_type_error: `${label} é obrigatório.` })
      .min(min, min <= 1 ? `${label} é obrigatório.` : `${label}: informe ao menos ${min} caracteres.`)
      .max(max, `${label}: no máximo ${max} caracteres.`),
  );

export const uuidSchema = z.string().uuid('Identificador inválido.');

/** CPF opcional: aceita com ou sem máscara; devolve só dígitos. */
export const cpfSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(onlyDigits)
    .refine(isValidCpf, 'CPF inválido.')
    .optional(),
);

export const cnsSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform(onlyDigits)
    .refine(isValidCns, 'CNS inválido.')
    .optional(),
);

export const phoneSchema = z
  .string()
  .transform(onlyDigits)
  .refine(isValidPhone, 'Telefone inválido. Informe DDD + número.');

/** "YYYY-MM-DD", data real, não futura, a partir de 1900. */
export const birthDateSchema = z
  .string({ required_error: 'Data de nascimento é obrigatória.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida.')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Data de nascimento inválida.')
  .refine((s) => s >= '1900-01-01', 'Data de nascimento inválida.')
  .refine((s) => s <= new Date().toISOString().slice(0, 10), 'A data de nascimento não pode ser futura.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Controle de concorrência otimista: o cliente informa a versão que está editando. */
export const expectedVersionSchema = z.number().int().min(0, 'Versão inválida.');
