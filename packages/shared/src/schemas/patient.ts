import { z } from 'zod';
import { PHONE_TYPES, SEXES } from '../enums';
import { accessibilitySchema } from './accessibility';
import {
  birthDateSchema,
  cnsSchema,
  cpfSchema,
  emptyToUndefined,
  expectedVersionSchema,
  optionalText,
  phoneSchema,
  requiredText,
} from './common';

export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const patientPhoneSchema = z.object({
  type: z.enum(PHONE_TYPES),
  number: phoneSchema,
});

export const patientAddressSchema = z.object({
  street: optionalText(200, 'Endereço'),
  number: optionalText(20, 'Número'),
  complement: optionalText(100, 'Complemento'),
  neighborhood: optionalText(100, 'Bairro'),
  city: optionalText(100, 'Município'),
  state: z.preprocess(
    (v) => (typeof v === 'string' ? emptyToUndefined(v.toUpperCase()) : v),
    z.enum(UF_LIST, { errorMap: () => ({ message: 'Estado inválido.' }) }).optional(),
  ),
  zipCode: z.preprocess(
    (v) => (typeof v === 'string' ? emptyToUndefined(v.replace(/\D/g, '')) : v),
    z.string().regex(/^\d{8}$/, 'CEP inválido.').optional(),
  ),
});

export const patientGuardianSchema = z.object({
  name: requiredText(3, 200, 'Nome do responsável'),
  cpf: cpfSchema,
  relationship: requiredText(2, 60, 'Parentesco'),
  phone: z.preprocess(emptyToUndefined, phoneSchema.optional()),
});

const patientFields = {
  fullName: requiredText(3, 200, 'Nome completo').refine((v) => v.trim().split(/\s+/).length >= 2, 'Informe nome e sobrenome.'),
  socialName: optionalText(200, 'Nome social'),
  cpf: cpfSchema,
  cns: cnsSchema,
  rg: optionalText(30, 'RG'),
  birthDate: birthDateSchema,
  sex: z.enum(SEXES, { errorMap: () => ({ message: 'Informe o sexo.' }) }),
  nationality: z.preprocess(emptyToUndefined, z.string().max(60).default('Brasileira')),
  birthplace: optionalText(100, 'Naturalidade'),
  motherName: optionalText(200, 'Nome da mãe'),
  phones: z.array(patientPhoneSchema).max(4, 'No máximo 4 telefones.').default([]),
  address: patientAddressSchema.default({}),
  guardian: patientGuardianSchema.nullable().optional(),
  accessibility: accessibilitySchema.default({ flags: [], needs: [] }),
};

export const createPatientSchema = z.object({
  ...patientFields,
  /** A recepção confirma que, apesar de haver um cadastro parecido (mesmo nome e nascimento), é outra pessoa. */
  confirmNotDuplicate: z.boolean().optional().default(false),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = z.object({
  ...patientFields,
  /** Conflito de edição: versão do cadastro que o usuário carregou. */
  expectedVersion: expectedVersionSchema,
  confirmNotDuplicate: z.boolean().optional().default(false),
});
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/** Busca: pelo menos um critério. `q` faz busca livre (CPF, CNS, prontuário, telefone ou nome). */
export const patientSearchSchema = z
  .object({
    q: z.preprocess(emptyToUndefined, z.string().min(2, 'Digite ao menos 2 caracteres.').max(200).optional()),
    cpf: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
    cns: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
    name: z.preprocess(emptyToUndefined, z.string().min(2).max(200).optional()),
    birthDate: z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    recordNumber: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
    phone: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(
    (v) => Boolean(v.q || v.cpf || v.cns || v.name || v.birthDate || v.recordNumber || v.phone),
    'Informe ao menos um critério de busca.',
  );
export type PatientSearchInput = z.infer<typeof patientSearchSchema>;
