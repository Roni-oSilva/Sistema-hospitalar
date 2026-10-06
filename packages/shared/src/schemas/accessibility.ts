import { z } from 'zod';
import { ACCESSIBILITY_FLAGS, ACCESSIBILITY_NEEDS, DISABILITY_TYPES } from '../enums';
import { emptyToUndefined } from './common';

/**
 * Perfil de acessibilidade. IMPORTANTE (regra de negócio): estas informações NUNCA alteram a classificação
 * clínica do paciente; servem para apoiar o atendimento (e, opcionalmente, o desempate legal configurado).
 */
export const accessibilityBaseSchema = z.object({
  flags: z.array(z.enum(ACCESSIBILITY_FLAGS)).max(ACCESSIBILITY_FLAGS.length).default([]),
  disabilityType: z.enum(DISABILITY_TYPES).nullable().optional(),
  needs: z.array(z.enum(ACCESSIBILITY_NEEDS)).max(ACCESSIBILITY_NEEDS.length).default([]),
  otherNeedDescription: z.preprocess(emptyToUndefined, z.string().max(300, 'Descrição: no máximo 300 caracteres.').optional()),
});

export const accessibilitySchema = accessibilityBaseSchema.superRefine((v, ctx) => {
  if (v.disabilityType && !v.flags.includes('PCD')) {
    ctx.addIssue({ code: 'custom', path: ['disabilityType'], message: 'Marque "Pessoa com deficiência (PCD)" para informar o tipo de deficiência.' });
  }
  const hasOther = v.flags.includes('OUTRA') || v.needs.includes('OUTRA');
  if (hasOther && !v.otherNeedDescription) {
    ctx.addIssue({ code: 'custom', path: ['otherNeedDescription'], message: 'Descreva a outra necessidade.' });
  }
});
export type AccessibilityInput = z.infer<typeof accessibilitySchema>;

export const emptyAccessibility: AccessibilityInput = { flags: [], disabilityType: null, needs: [], otherNeedDescription: undefined };
