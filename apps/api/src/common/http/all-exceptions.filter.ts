import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppLogger } from '../logger/app-logger';
import { AppError, ErrorCodes } from '../errors/app-error';
import { ValidationFailed, zodIssuesToFieldErrors } from './zod-validation.pipe';

const GENERIC = 'Não foi possível concluir a operação. Tente novamente.';

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  details?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Filtro global: o funcionário NUNCA vê erro técnico (PrismaClientKnownRequestError, SQL, stack).
 * O erro técnico completo vai para o log, correlacionado pelo requestId que também volta na resposta.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    const { status, body } = this.map(exception);
    body.requestId = requestId;

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`Erro não tratado em ${req.method} ${req.path}`, {
        requestId,
        name: err?.name,
        detail: err?.message,
        stack: err?.stack,
      });
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  }

  private map(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof ValidationFailed) {
      return { status: 422, body: { code: ErrorCodes.VALIDATION, message: 'Verifique os dados informados.', fieldErrors: exception.fieldErrors } };
    }
    if (exception instanceof ZodError) {
      return { status: 422, body: { code: ErrorCodes.VALIDATION, message: 'Verifique os dados informados.', fieldErrors: zodIssuesToFieldErrors(exception.issues) } };
    }
    if (exception instanceof AppError) {
      return { status: exception.status, body: { code: exception.code, message: exception.message, details: exception.details } };
    }
    if (exception instanceof HttpException) {
      return this.mapHttp(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: 400, body: { code: 'BAD_REQUEST', message: 'Não foi possível processar os dados enviados.' } };
    }
    // Exceções levantadas pelas travas do banco (triggers/CHECK) chegam como erro desconhecido do Prisma
    const msg = (exception as { message?: string })?.message ?? '';
    if (/integrity_constraint_violation|violates check constraint|Registro imutável|Transição de status inválida/i.test(msg)) {
      return { status: 409, body: { code: ErrorCodes.INVALID_STATE, message: 'A operação não é permitida no estado atual do registro.' } };
    }
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: GENERIC } };
  }

  private mapHttp(e: HttpException): { status: number; body: ErrorBody } {
    const status = e.getStatus();
    switch (status) {
      case 400:
        return { status, body: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } };
      case 401:
        return { status, body: { code: 'UNAUTHENTICATED', message: 'Sessão inválida ou expirada. Entre novamente.' } };
      case 403:
        return { status, body: { code: 'FORBIDDEN', message: 'Você não tem permissão para realizar esta ação.' } };
      case 404:
        return { status, body: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } };
      case 413:
        return { status, body: { code: 'PAYLOAD_TOO_LARGE', message: 'Os dados enviados são grandes demais.' } };
      case 429:
        return { status, body: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.' } };
      default:
        return { status: status >= 500 ? 500 : status, body: { code: 'ERROR', message: GENERIC } };
    }
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): { status: number; body: ErrorBody } {
    switch (e.code) {
      case 'P2002':
        return { status: 409, body: { code: 'CONFLICT', message: 'Já existe um registro com estes dados.' } };
      case 'P2025':
        return { status: 404, body: { code: 'NOT_FOUND', message: 'Registro não encontrado.' } };
      case 'P2003':
        return { status: 409, body: { code: 'CONFLICT', message: 'A operação referencia um registro que não existe ou está em uso.' } };
      case 'P2034': // write conflict / deadlock em transação
        return { status: 409, body: { code: 'CONFLICT', message: 'Outro usuário alterou este registro ao mesmo tempo. Atualize a tela e tente novamente.' } };
      default:
        return { status: 500, body: { code: 'INTERNAL_ERROR', message: GENERIC } };
    }
  }
}
