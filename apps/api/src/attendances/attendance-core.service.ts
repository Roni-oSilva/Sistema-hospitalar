import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AttendanceStatus,
  PERMISSIONS,
  TIMELINE_EVENT_LABELS,
  TimelineCategory,
  TimelineEventType,
  canTransition,
  STATUS_LABELS,
} from '@hospital/shared';
import type { Tx } from '../common/prisma/prisma.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { Actor, can } from '../auth/auth.types';
import { ErrorCodes, conflict, notFound } from '../common/errors/app-error';

/** Eventos GENERAL aparecem para qualquer perfil com acesso ao atendimento; CLINICAL só para quem tem permissão clínica. */
export const EVENT_CATEGORY: Record<TimelineEventType, TimelineCategory> = {
  ENTRADA: 'GENERAL',
  TRIAGEM_INICIADA: 'GENERAL',
  TRIAGEM_DEVOLVIDA: 'GENERAL',
  TRIAGEM_FINALIZADA: 'GENERAL',
  CLASSIFICACAO_ALTERADA: 'CLINICAL',
  ACESSIBILIDADE_ATUALIZADA: 'GENERAL',
  CHAMADO: 'GENERAL',
  RECHAMADO: 'GENERAL',
  DEVOLVIDO_A_FILA: 'GENERAL',
  ATENDIMENTO_INICIADO: 'GENERAL',
  DIAGNOSTICO_REGISTRADO: 'CLINICAL',
  MEDICACAO_REGISTRADA: 'GENERAL',
  REGISTRO_CORRIGIDO: 'CLINICAL',
  COMPLEMENTO_REGISTRADO: 'CLINICAL',
  ATENDIMENTO_FINALIZADO: 'GENERAL',
  ATENDIMENTO_CANCELADO: 'GENERAL',
};

export interface AttendanceRef {
  id: string;
  code: string;
  status: AttendanceStatus;
}

@Injectable()
export class AttendanceCoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transição de status ATÔMICA: `UPDATE … WHERE id = ? AND status = <esperado>`. Se dois usuários tentam o mesmo
   * passo ao mesmo tempo, só um altera (count = 1); o outro recebe conflito — nunca há atualização perdida.
   * O histórico (attendance_status_history) é sempre acrescentado, nunca sobrescrito.
   */
  async transition(
    tx: Tx,
    att: AttendanceRef,
    to: AttendanceStatus,
    actor: Actor,
    opts: { reason?: string; data?: Prisma.AttendanceUncheckedUpdateManyInput } = {},
  ): Promise<void> {
    if (!canTransition(att.status, to)) {
      throw conflict(`Esta ação não é possível com o atendimento em "${STATUS_LABELS[att.status]}".`, ErrorCodes.INVALID_STATE, { status: att.status });
    }
    const res = await tx.attendance.updateMany({
      where: { id: att.id, status: att.status },
      data: { ...opts.data, status: to, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      throw conflict('Este atendimento acabou de ser alterado por outro usuário. Atualize a tela.', ErrorCodes.EDIT_CONFLICT);
    }
    await tx.attendanceStatusHistory.create({
      data: {
        attendanceId: att.id,
        fromStatus: att.status,
        toStatus: to,
        changedById: actor.userId,
        sectorCode: actor.sectorCode,
        reason: opts.reason ?? null,
        ip: actor.ip?.slice(0, 64) ?? null,
      },
    });
  }

  addEvent(tx: Tx, attendanceId: string, type: TimelineEventType, actor: Actor | null, detail?: Record<string, unknown>) {
    return tx.attendanceEvent.create({
      data: {
        attendanceId,
        type,
        category: EVENT_CATEGORY[type],
        actorId: actor?.userId ?? null,
        sectorCode: actor?.sectorCode ?? null,
        detail: detail ? (detail as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }

  /** Carrega o atendimento (ref mínima) ou 404. */
  async getRef(db: PrismaService | Tx, id: string): Promise<AttendanceRef & { patientId: string; version: number }> {
    const a = await db.attendance.findUnique({ where: { id }, select: { id: true, code: true, status: true, patientId: true, version: true } });
    if (!a) throw notFound('Atendimento não encontrado.');
    return a as AttendanceRef & { patientId: string; version: number };
  }

  /** Quem pode ver os DETALHES clínicos de uma linha do tempo. */
  canSeeClinicalDetail(actor: Actor): boolean {
    return can(actor, PERMISSIONS.TRIAGE_READ) || can(actor, PERMISSIONS.CONSULTATION_READ);
  }

  eventLabel(type: TimelineEventType): string {
    return TIMELINE_EVENT_LABELS[type];
  }
}
