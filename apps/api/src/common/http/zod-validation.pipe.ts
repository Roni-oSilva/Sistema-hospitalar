import { PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

/** Falha de validação de entrada — convertida em 422 com erros por campo pelo filtro global. */
export class ValidationFailed extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Validation failed');
  }
}

export function zodIssuesToFieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Valida e normaliza (trim, só dígitos em CPF etc. via schema) o corpo/consulta.
 * Campos desconhecidos são descartados (zod strip) — evita mass-assignment.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) throw new ValidationFailed(zodIssuesToFieldErrors(result.error.issues));
    return result.data;
  }
}

export const zbody = <T extends ZodTypeAny>(schema: T) => new ZodValidationPipe(schema);
