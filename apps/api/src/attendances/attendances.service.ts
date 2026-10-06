import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  AttendanceStatus,
  CreateAttendanceInput,
  ListAttendancesInput,
  PERMISSIONS,
  RISK_META,
  RiskLevel,
  STATUS_LABELS,
  TimelineEventType,
  UpdateAttendanceAccessibilityInput,
  dayRange,
  isTerminal,
  localDateString,
  normalizeText,
  onlyDigits,
} from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueuePriorityService } from '../queue/queue-priority.service';
import { SequenceService, formatTicket } from '../common/sequence.service';
import { Actor, can, canAny } from '../auth/auth.types';
import { ErrorCodes, conflict, forbidden, notFound } from '../common/errors/app-error';
import { AttendanceCoreService } from './attendance-core.service';
import { accessibilityDto, patientBasic, toDateOnlyDate } from './attendance.mapper';

const LIST_INCLUDE = {
  patient: { select: { id: true, recordNumber: true, fullName: true, socialName: true, birthDate: true, sex: true } },
  accessibility: true,
} satisfies Prisma.AttendanceInclude;

@Injectable()
export class AttendancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: AttendanceCoreService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly priority: QueuePriorityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private canSeeRisk(actor: Actor): boolean {
    return canAny(actor, PERMISSIONS.TRIAGE_READ, PERMISSIONS.CONSULTATION_READ, PERMISSIONS.MEDICAL_QUEUE, PERMISSIONS.INDICATORS_READ);
  }

  // ───────────────────────────── criação ─────────────────────────────

  async create(actor: Actor, input: CreateAttendanceInput) {
    const result = await this.prisma.run(async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id: input.patientId }, include: { accessibility: true } });
      if (!patient) throw notFound('Paciente não encontrado.');

      const active = await tx.attendance.findFirst({
        where: { patientId: patient.id, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, code: true, status: true },
      });
      if (active) {
        throw conflict(`Este paciente já possui um atendimento em andamento (${active.code} — ${STATUS_LABELS[active.status]}).`, ErrorCodes.ACTIVE_ATTENDANCE_EXISTS, active);
      }

      const now = new Date();
      const n = await this.sequences.nextAttendanceNumbers(tx, now);
      const acc = input.accessibility ?? {
        flags: patient.accessibility?.flags ?? [],
        disabilityType: patient.accessibility?.disabilityType ?? null,
        needs: patient.accessibility?.needs ?? [],
        otherNeedDescription: patient.accessibility?.otherNeedDescription ?? undefined,
      };

      let attendance;
      try {
        attendance = await tx.attendance.create({
          data: {
            code: n.code,
            year: n.year,
            sequence: n.sequence,
            ticketDate: toDateOnlyDate(n.ticketDate),
            ticketNumber: n.ticketNumber,
            patientId: patient.id,
            kind: input.kind,
            reason: input.reason ?? null,
            arrivedAt: now,
            createdById: actor.userId,
            createdSectorCode: actor.sectorCode,
            clientIp: actor.ip?.slice(0, 64) ?? null,
            userAgent: actor.userAgent?.slice(0, 255) ?? null,
            deviceLabel: input.deviceLabel ?? null,
            accessibility: {
              create: { flags: acc.flags, disabilityType: acc.disabilityType ?? null, needs: acc.needs, otherNeedDescription: acc.otherNeedDescription ?? null, updatedById: actor.userId },
            },
          },
        });
      } catch (e) {
        // corrida: outra recepção criou atendimento para o mesmo paciente no mesmo instante (índice parcial único)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw conflict('Este paciente acabou de receber um atendimento em outro computador.', ErrorCodes.ACTIVE_ATTENDANCE_EXISTS);
        }
        throw e;
      }

      await tx.attendanceStatusHistory.create({
        data: { attendanceId: attendance.id, fromStatus: null, toStatus: 'AGUARDANDO_TRIAGEM', changedById: actor.userId, sectorCode: actor.sectorCode, ip: actor.ip?.slice(0, 64) ?? null },
      });
      await this.core.addEvent(tx, attendance.id, 'ENTRADA', actor, { ticket: formatTicket(n.ticketNumber) });
      await tx.queueEntry.create({ data: { attendanceId: attendance.id, kind: 'TRIAGEM', priorityScore: 0, enqueuedAt: now } });
      await this.notifications.create(tx, {
        type: 'NOVO_ATENDIMENTO',
        title: 'Novo paciente aguardando triagem',
        message: `Atendimento ${n.code} (senha ${formatTicket(n.ticketNumber)}) entrou na fila de triagem.`,
        targetRole: 'TRIAGEM',
        attendanceCode: n.code,
      });
      await this.audit.record(tx, actor, {
        action: 'ATTENDANCE_CREATED',
        entityType: 'Attendance',
        entityId: attendance.id,
        patientId: patient.id,
        attendanceId: attendance.id,
        attendanceCode: n.code,
        metadata: { kind: input.kind, ticket: n.ticketNumber, deviceLabel: input.deviceLabel },
      });
      return { id: attendance.id, code: n.code, ticket: formatTicket(n.ticketNumber), status: 'AGUARDANDO_TRIAGEM' as AttendanceStatus, arrivedAt: now.toISOString(), patientName: patient.fullName };
    });

    this.realtime.queueChanged('TRIAGEM');
    this.realtime.attendanceChanged(result.id, result.status);
    this.realtime.notification('TRIAGEM');
    return result;
  }

  // ───────────────────────────── consulta ─────────────────────────────

  async list(actor: Actor, input: ListAttendancesInput) {
    const date = input.date ?? localDateString(new Date(), this.config.timezone);
    const { start, end } = dayRange(date, this.config.timezone);
    const and: Prisma.AttendanceWhereInput[] = [{ arrivedAt: { gte: start, lt: end } }];
    if (input.status?.length) and.push({ status: { in: input.status } });
    if (input.search) {
      const s = input.search.trim();
      const digits = onlyDigits(s);
      if (/^atd-/i.test(s)) and.push({ code: { contains: s.toUpperCase() } });
      else if (digits.length > 0 && digits.length <= 4 && digits === s) and.push({ ticketNumber: Number(digits) });
      else and.push(...normalizeText(s).split(' ').filter(Boolean).map((t) => ({ patient: { normalizedName: { contains: t } } })));
    }

    const rows = await this.prisma.attendance.findMany({ where: { AND: and }, include: LIST_INCLUDE, orderBy: { arrivedAt: 'desc' }, take: input.limit });
    const showRisk = this.canSeeRisk(actor);
    const now = new Date();
    return {
      date,
      items: rows.map((a) => ({
        id: a.id,
        code: a.code,
        ticket: formatTicket(a.ticketNumber),
        status: a.status,
        kind: a.kind,
        reason: a.reason,
        arrivedAt: a.arrivedAt.toISOString(),
        finishedAt: a.finishedAt?.toISOString() ?? null,
        riskLevel: showRisk ? a.currentRiskLevel : null,
        patient: patientBasic(a.patient, now),
        accessibility: accessibilityDto(a.accessibility, a.patient.birthDate),
      })),
    };
  }

  /** Visão administrativa (não clínica) do atendimento: identificação, status, horários, acessibilidade. */
  async get(actor: Actor, id: string) {
    const a = await this.prisma.attendance.findUnique({
      where: { id },
      include: { ...LIST_INCLUDE, createdBy: { select: { fullName: true } }, queueEntries: { include: { room: true, assignedUser: { select: { fullName: true } } } } },
    });
    if (!a) throw notFound('Atendimento não encontrado.');
    const showRisk = this.canSeeRisk(actor);
    const medical = a.queueEntries.find((q) => q.kind === 'MEDICA');
    return {
      id: a.id,
      code: a.code,
      ticket: formatTicket(a.ticketNumber),
      status: a.status,
      kind: a.kind,
      reason: a.reason,
      version: a.version,
      riskLevel: showRisk ? a.currentRiskLevel : null,
      arrivedAt: a.arrivedAt.toISOString(),
      triageStartedAt: a.triageStartedAt?.toISOString() ?? null,
      triageFinishedAt: a.triageFinishedAt?.toISOString() ?? null,
      firstCalledAt: a.firstCalledAt?.toISOString() ?? null,
      consultationStartedAt: a.consultationStartedAt?.toISOString() ?? null,
      finishedAt: a.finishedAt?.toISOString() ?? null,
      cancelledAt: a.cancelledAt?.toISOString() ?? null,
      cancelReason: a.cancelReason,
      createdBy: a.createdBy.fullName,
      room: medical?.room?.name ?? null,
      doctor: medical?.assignedUser?.fullName ?? null,
      patient: patientBasic(a.patient),
      accessibility: accessibilityDto(a.accessibility, a.patient.birthDate),
    };
  }

  async timeline(actor: Actor, id: string) {
    const exists = await this.prisma.attendance.findUnique({ where: { id }, select: { id: true, patientId: true, code: true } });
    if (!exists) throw notFound('Atendimento não encontrado.');
    const clinical = this.core.canSeeClinicalDetail(actor);
    const events = await this.prisma.attendanceEvent.findMany({
      where: { attendanceId: id, ...(clinical ? {} : { category: 'GENERAL' }) },
      include: { actor: { select: { fullName: true, professionalRegister: true } } },
      orderBy: { occurredAt: 'asc' },
    });
    if (clinical) {
      await this.audit.record(this.prisma, actor, { action: 'TIMELINE_VIEWED', entityType: 'Attendance', entityId: id, attendanceId: id, attendanceCode: exists.code, patientId: exists.patientId });
    }
    return events.map((e) => {
      const detail = clinical ? ((e.detail as Record<string, unknown> | null) ?? null) : null;
      return {
        id: e.id,
        type: e.type,
        label: this.core.eventLabel(e.type as TimelineEventType),
        category: e.category,
        occurredAt: e.occurredAt.toISOString(),
        actor: e.actor ? { name: e.actor.fullName, register: e.actor.professionalRegister } : null,
        sector: e.sectorCode,
        detail,
        summary: clinical ? this.summarize(e.type as TimelineEventType, detail) : null,
      };
    });
  }

  private summarize(type: TimelineEventType, detail: Record<string, unknown> | null): string | null {
    if (!detail) return null;
    const level = detail.level as RiskLevel | undefined;
    switch (type) {
      case 'TRIAGEM_FINALIZADA':
        return level ? `Classificação: ${RISK_META[level].label}` : null;
      case 'CLASSIFICACAO_ALTERADA':
        return level ? `${detail.previousLevel ? `${RISK_META[detail.previousLevel as RiskLevel].label} → ` : ''}${RISK_META[level].label}` : null;
      case 'CHAMADO':
      case 'RECHAMADO':
        return detail.room ? `${detail.room}` : null;
      case 'ATENDIMENTO_FINALIZADO':
        return detail.outcomeLabel ? `Desfecho: ${detail.outcomeLabel}` : null;
      case 'ATENDIMENTO_CANCELADO':
        return detail.reason ? `Motivo: ${detail.reason}` : null;
      default:
        return (detail.summary as string | undefined) ?? null;
    }
  }

  // ───────────────────────────── acessibilidade da visita ─────────────────────────────

  async updateAccessibility(actor: Actor, id: string, input: UpdateAttendanceAccessibilityInput) {
    const res = await this.prisma.run(async (tx) => {
      const a = await tx.attendance.findUnique({ where: { id }, include: { accessibility: true, patient: { select: { birthDate: true } } } });
      if (!a) throw notFound('Atendimento não encontrado.');
      if (isTerminal(a.status)) throw conflict('O atendimento já foi encerrado.', ErrorCodes.INVALID_STATE);
      const acc = input.accessibility;
      const data = { flags: acc.flags, disabilityType: acc.disabilityType ?? null, needs: acc.needs, otherNeedDescription: acc.otherNeedDescription ?? null, updatedById: actor.userId };
      await tx.attendanceAccessibility.upsert({ where: { attendanceId: id }, create: { attendanceId: id, ...data }, update: data });
      if (input.updatePatientProfile) {
        await tx.patientAccessibility.upsert({ where: { patientId: a.patientId }, create: { patientId: a.patientId, ...data }, update: data });
      }
      // se o paciente aguarda o médico e o desempate legal está ligado, a posição pode mudar (nunca o nível de risco)
      if (a.currentRiskLevel) await this.priority.refresh(tx, id, a.currentRiskLevel, acc.flags, a.patient.birthDate);

      const changes = this.audit.diff(
        { flags: a.accessibility?.flags.join(',') ?? '', disabilityType: a.accessibility?.disabilityType ?? null, needs: a.accessibility?.needs.join(',') ?? '' },
        { flags: acc.flags.join(','), disabilityType: acc.disabilityType ?? null, needs: acc.needs.join(',') },
      );
      await this.core.addEvent(tx, id, 'ACESSIBILIDADE_ATUALIZADA', actor);
      await this.audit.record(tx, actor, {
        action: 'ATTENDANCE_ACCESSIBILITY_UPDATED',
        entityType: 'Attendance',
        entityId: id,
        attendanceId: id,
        attendanceCode: a.code,
        patientId: a.patientId,
        ...(changes ? { changes } : {}),
        metadata: { updatePatientProfile: input.updatePatientProfile },
      });
      return { status: a.status };
    });
    this.realtime.queueChanged('TRIAGEM');
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(id, res.status);
    return this.get(actor, id);
  }

  // ───────────────────────────── cancelamento ─────────────────────────────

  /**
   * Cancelamento (ex.: paciente desistiu/evadiu) — só ANTES do início do atendimento médico, com motivo obrigatório.
   * Quem pode: recepção (aguardando triagem), triagem (até finalizar a triagem), médico (aguardando médico).
   */
  async cancel(actor: Actor, id: string, reason: string) {
    const out = await this.prisma.run(async (tx) => {
      const a = await this.core.getRef(tx, id);
      const allowed =
        (a.status === 'AGUARDANDO_TRIAGEM' && canAny(actor, PERMISSIONS.ATTENDANCES_CANCEL, PERMISSIONS.TRIAGE_PERFORM)) ||
        (a.status === 'EM_TRIAGEM' && can(actor, PERMISSIONS.TRIAGE_PERFORM)) ||
        (a.status === 'AGUARDANDO_MEDICO' && can(actor, PERMISSIONS.MEDICAL_ATTEND));
      if (!allowed) {
        if (isTerminal(a.status) || a.status === 'EM_ATENDIMENTO' || a.status === 'MEDICACAO_REGISTRADA') {
          throw conflict('Atendimentos já iniciados pelo médico não podem ser cancelados; finalize com o desfecho "Outro".', ErrorCodes.INVALID_STATE);
        }
        throw forbidden('Seu perfil não pode cancelar o atendimento nesta etapa.');
      }
      const now = new Date();
      await this.core.transition(tx, a, 'CANCELADO', actor, { reason, data: { cancelledAt: now, cancelReason: reason } });
      await tx.queueEntry.updateMany({ where: { attendanceId: id, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } }, data: { status: 'CANCELLED', finishedAt: now } });
      await this.core.addEvent(tx, id, 'ATENDIMENTO_CANCELADO', actor, { reason });
      await this.audit.record(tx, actor, { action: 'ATTENDANCE_CANCELLED', entityType: 'Attendance', entityId: id, attendanceId: id, attendanceCode: a.code, patientId: a.patientId, metadata: { fromStatus: a.status } });
      return { id, status: 'CANCELADO' as AttendanceStatus };
    });
    this.realtime.queueChanged('TRIAGEM');
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(id, out.status);
    return out;
  }
}
