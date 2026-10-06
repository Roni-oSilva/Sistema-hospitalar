import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string({ required_error: 'Informe o usuário.' })
    .trim()
    .toLowerCase()
    .min(1, 'Informe o usuário.')
    .max(60),
  password: z.string({ required_error: 'Informe a senha.' }).min(1, 'Informe a senha.').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Lista curta de senhas notoriamente fracas. A defesa principal é o comprimento + hash argon2id + bloqueio por tentativas.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'senha123', 'senha1234', 'senha12345', '1234567890', '12345678910', 'qwertyuiop',
  'admin12345', 'hospital123', 'hospital1234', 'mudar123456', 'trocar12345', 'abcd123456', '0123456789',
]);

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string({ required_error: 'Informe a senha.' })
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(128, 'A senha deve ter no máximo 128 caracteres.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'A senha deve conter letras e números.')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'Essa senha é muito comum. Escolha outra.');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'A nova senha deve ser diferente da atual.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
