/**
 * Contrato do tempo real (Socket.IO).
 *
 * Princípio de privacidade: eventos carregam apenas IDs e tipo de mudança — NUNCA dados clínicos nem pessoais.
 * O cliente reage buscando os dados pela API REST (que valida a permissão de novo).
 */
export const REALTIME_EVENTS = {
  QUEUE_CHANGED: 'queue.changed',
  ATTENDANCE_CHANGED: 'attendance.changed',
  NOTIFICATION: 'notification.new',
  /** Namespace público /painel */
  PANEL_CALL: 'panel.call',
} as const;

export interface QueueChangedEvent {
  kind: 'TRIAGEM' | 'MEDICA';
}

export interface AttendanceChangedEvent {
  attendanceId: string;
  status: string;
}

export interface PanelCallEvent {
  /** Senha do dia (ex.: "042") */
  ticket: string;
  /** Número do atendimento (ex.: "ATD-2026-000123") */
  code: string;
  /** Nome do consultório (ex.: "Consultório 01") */
  room: string;
  calledAt: string;
  recall: boolean;
}

/** Salas (rooms) do socket autenticado, por permissão. */
export const SOCKET_ROOMS = {
  RECEPCAO: 'sector:recepcao',
  TRIAGEM: 'sector:triagem',
  MEDICO: 'sector:medico',
  ADMIN: 'sector:admin',
} as const;
