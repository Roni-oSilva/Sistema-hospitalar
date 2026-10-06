/**
 * Erros de negócio com mensagem SEGURA em pt-BR (pode ir direto para o funcionário) e código estável para o frontend.
 * Detalhes técnicos nunca entram na resposta — vão para o log.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Sessão inválida ou expirada. Entre novamente.', code = 'UNAUTHENTICATED') => new AppError(401, code, message);
export const forbidden = (message = 'Você não tem permissão para realizar esta ação.', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'Registro não encontrado.', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', details?: Record<string, unknown>) => new AppError(409, code, message, details);
export const unprocessable = (message: string, code = 'BUSINESS_RULE', details?: Record<string, unknown>) => new AppError(422, code, message, details);

export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  EDIT_CONFLICT: 'EDIT_CONFLICT',
  ALREADY_TAKEN: 'ALREADY_TAKEN',
  ACTIVE_ATTENDANCE_EXISTS: 'ACTIVE_ATTENDANCE_EXISTS',
  DUPLICATE_DOCUMENT: 'DUPLICATE_DOCUMENT',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  QUEUE_EMPTY: 'QUEUE_EMPTY',
  ROOM_BUSY: 'ROOM_BUSY',
  DOCTOR_BUSY: 'DOCTOR_BUSY',
  INVALID_STATE: 'INVALID_STATE',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
} as const;
