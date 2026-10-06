import type { AttendanceStatus } from './enums';

/**
 * Máquina de estados do atendimento.
 *
 * Cancelar só é possível ANTES do início do atendimento médico; depois de iniciado, encerra-se com desfecho "Outro" + observação.
 *
 * A "chamada" do paciente NÃO é um estado do atendimento: ela vive na fila (queue.status = CALLED), porque é
 * um claim atômico entre médicos. O atendimento permanece AGUARDANDO_MEDICO até o médico iniciar o atendimento.
 */
export const ALLOWED_TRANSITIONS: Record<AttendanceStatus, readonly AttendanceStatus[]> = {
  AGUARDANDO_TRIAGEM: ['EM_TRIAGEM', 'CANCELADO'],
  EM_TRIAGEM: ['AGUARDANDO_MEDICO', 'AGUARDANDO_TRIAGEM', 'CANCELADO'],
  AGUARDANDO_MEDICO: ['EM_ATENDIMENTO', 'CANCELADO'],
  EM_ATENDIMENTO: ['MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO'],
  MEDICACAO_REGISTRADA: ['ATENDIMENTO_FINALIZADO'],
  ATENDIMENTO_FINALIZADO: [],
  CANCELADO: [],
};

export const TERMINAL_STATUSES: readonly AttendanceStatus[] = ['ATENDIMENTO_FINALIZADO', 'CANCELADO'];
export const ACTIVE_STATUSES: readonly AttendanceStatus[] = [
  'AGUARDANDO_TRIAGEM',
  'EM_TRIAGEM',
  'AGUARDANDO_MEDICO',
  'EM_ATENDIMENTO',
  'MEDICACAO_REGISTRADA',
];

/** Estados em que a triagem ainda pode ser editada livremente. */
export const TRIAGE_EDITABLE_STATUSES: readonly AttendanceStatus[] = ['EM_TRIAGEM'];
/** Estados em que a triagem pode ser corrigida (com justificativa), antes do médico assumir. */
export const TRIAGE_CORRECTABLE_STATUSES: readonly AttendanceStatus[] = ['AGUARDANDO_MEDICO'];
/** Estados em que o médico pode editar a consulta livremente. */
export const CONSULTATION_EDITABLE_STATUSES: readonly AttendanceStatus[] = ['EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'];

export function canTransition(from: AttendanceStatus, to: AttendanceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: AttendanceStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActive(status: AttendanceStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
