import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  AttendanceChangedEvent,
  PanelCallEvent,
  QueueChangedEvent,
  REALTIME_EVENTS,
  SOCKET_ROOMS,
} from '@hospital/shared';

/**
 * Ponto único para publicar eventos em tempo real. Os serviços chamam isto DEPOIS do commit da transação.
 * Payloads só têm IDs/tipos — nunca dados clínicos ou pessoais (o cliente rebusca pela API, que valida permissão).
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private panelServer: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  attachPanel(server: Server): void {
    this.panelServer = server;
  }

  queueChanged(kind: QueueChangedEvent['kind']): void {
    const payload: QueueChangedEvent = { kind };
    // quem acompanha a fila: recepção (status), triagem, médicos e administração (indicadores)
    this.server?.to([SOCKET_ROOMS.RECEPCAO, SOCKET_ROOMS.TRIAGEM, SOCKET_ROOMS.MEDICO, SOCKET_ROOMS.ADMIN]).emit(REALTIME_EVENTS.QUEUE_CHANGED, payload);
  }

  attendanceChanged(attendanceId: string, status: string): void {
    const payload: AttendanceChangedEvent = { attendanceId, status };
    this.server?.to([SOCKET_ROOMS.RECEPCAO, SOCKET_ROOMS.TRIAGEM, SOCKET_ROOMS.MEDICO, SOCKET_ROOMS.ADMIN]).emit(REALTIME_EVENTS.ATTENDANCE_CHANGED, payload);
  }

  notification(role: string | null): void {
    const rooms = role ? [roleRoom(role)] : Object.values(SOCKET_ROOMS);
    this.server?.to(rooms).emit(REALTIME_EVENTS.NOTIFICATION, { at: new Date().toISOString() });
  }

  /** Painel público: somente senha, número do atendimento e consultório. */
  panelCall(event: PanelCallEvent): void {
    this.panelServer?.emit(REALTIME_EVENTS.PANEL_CALL, event);
  }

  disconnectUser(userId: string): void {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }
}

export function roleRoom(roleCode: string): string {
  switch (roleCode) {
    case 'RECEPCAO':
      return SOCKET_ROOMS.RECEPCAO;
    case 'TRIAGEM':
      return SOCKET_ROOMS.TRIAGEM;
    case 'MEDICO':
      return SOCKET_ROOMS.MEDICO;
    default:
      return SOCKET_ROOMS.ADMIN;
  }
}
