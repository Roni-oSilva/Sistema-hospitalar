import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AddDiagnosisInput,
  CLAIM_STALE_MINUTES,
  FinishConsultationInput,
  OUTCOME_LABELS,
  PERMISSIONS,
  PanelCallEvent,
  PrescriptionItemInput,
  RISK_META,
  RiskLevel,
  SaveConsultationInput,
  maskCns,
  maskCpf,
  minutesBetween,
} from '@hospital/shared';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { AttendanceCoreService } from '../attendances/attendance-core.service';
import { AttendancesService } from '../attendances/attendances.service';
import { ClinicalVersioningService, changedFields } from '../clinical/clinical-versioning.service';
import { Actor, can } from '../auth/auth.types';
import { ErrorCodes, conflict, forbidden, notFound, unprocessable } from '../common/errors/app-error';
import { formatTicket } from '../common/sequence.service';
import { accessibilityDto, patientBasic } from '../attendances/attendance.mapper';
import { vitalsDto } from '../triage/triage.service';

const CONSULTATION_TEXT_FIELDS = ['chiefComplaint', 'history', 'examination', 'conduct'] as const;
type ConsultationText = Record<(typeof CONSULTATION_TEXT_FIELDS)[number], string | null>;

/** Estados em que o médico pode abrir o prontuário do atendimento. */
const MEDICAL_VISIBLE_STATUSES = ['AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA', 'ATENDIMENTO_FINALIZADO'];
const EDITABLE = ['EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'];

interface ClaimedRow {
  id: string;
  attendance_id: string;
  call_count: number;
}

@Injectable()
export class MedicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: AttendanceCoreService,
    private readonly attendances: AttendancesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly versions: ClinicalVersioningService,
  ) {}

  // ───────────────────────────── fila médica ─────────────────────────────

  async queue(actor: Actor) {
    const [entries, maxWait] = await Promise.all([
      this.prisma.queueEntry.findMany({
        where: { kind: 'MEDICA', status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
        include: {
          room: { select: { id: true, name: true } },
          assignedUser: { select: { id: true, fullName: true } },
          attendance: {
            include: {
              patient: { select: { id: true, recordNumber: true, fullName: true, socialName: true, birthDate: true, sex: true } },
              accessibility: true,
              triage: { select: { chiefComplaint: true } },
            },
          },
        },
        orderBy: [{ priorityScore: 'asc' }, { enqueuedAt: 'asc' }],
      }),
      this.settings.get('triage.max_wait_minutes'),
    ]);
    const now = new Date();
    let position = 0;
    const items = entries.map((e) => {
      const level = e.attendance.currentRiskLevel as RiskLevel;
      const waiting = minutesBetween(e.enqueuedAt, now);
      const max = maxWait[level];
      if (e.status === 'WAITING') position += 1;
      return {
        attendanceId: e.attendanceId,
        code: e.attendance.code,
        ticket: formatTicket(e.attendance.ticketNumber),
        status: e.attendance.status,
        queueStatus: e.status,
        position: e.status === 'WAITING' ? position : null,
        riskLevel: level,
        enqueuedAt: e.enqueuedAt.toISOString(),
        waitingMinutes: waiting,
        maxWaitMinutes: max,
        overdue: e.status === 'WAITING' && waiting > max,
        chiefComplaint: e.attendance.triage?.chiefComplaint ?? e.attendance.reason,
        patient: patientBasic(e.attendance.patient, now),
        accessibility: accessibilityDto(e.attendance.accessibility, e.attendance.patient.birthDate),
        room: e.room?.name ?? null,
        assignedTo: e.assignedUser ? { id: e.assignedUser.id, name: e.assignedUser.fullName, isMe: e.assignedUser.id === actor.userId } : null,
        calledAt: e.calledAt?.toISOString() ?? null,
        callCount: e.callCount,
      };
    });
    return {
      waiting: items.filter((i) => i.queueStatus === 'WAITING'),
      mine: items.find((i) => i.assignedTo?.isMe) ?? null,
      inService: items.filter((i) => i.queueStatus !== 'WAITING' && !i.assignedTo?.isMe),
    };
  }

  private async assertCanTakePatient(tx: Tx, actor: Actor, roomId: string, exceptEntryId?: string) {
    // Serializa chamadas do MESMO médico e do MESMO consultório (ex.: duplo clique, duas abas) ANTES de tocar a fila.
    // Sem isto, um clique fadado a falhar ("médico ocupado") travaria um paciente com SKIP LOCKED e outro médico
    // veria a fila "vazia". Ordem fixa médico → consultório: sem deadlock entre médicos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`medical-doctor:${actor.userId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`medical-room:${roomId}`}))`;
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { sector: true } });
    if (!room || !room.isActive) throw unprocessable('Selecione um consultório ativo.', 'INVALID_ROOM');
    const mine = await tx.queueEntry.findFirst({
      where: { kind: 'MEDICA', assignedUserId: actor.userId, status: { in: ['CALLED', 'IN_SERVICE'] }, ...(exceptEntryId ? { id: { not: exceptEntryId } } : {}) },
      include: { attendance: { select: { code: true } } },
    });
    if (mine) {
      throw conflict(`Você já está com o paciente do atendimento ${mine.attendance.code}. Finalize ou devolva-o à fila antes de chamar outro.`, ErrorCodes.DOCTOR_BUSY, { attendanceId: mine.attendanceId });
    }
    const busy = await tx.queueEntry.findFirst({
      where: { kind: 'MEDICA', roomId, status: { in: ['CALLED', 'IN_SERVICE'] }, ...(exceptEntryId ? { id: { not: exceptEntryId } } : {}) },
      include: { assignedUser: { select: { fullName: true } } },
    });
    if (busy) throw conflict(`${room.name} está em uso por ${busy.assignedUser?.fullName ?? 'outro profissional'}.`, ErrorCodes.ROOM_BUSY);
    return room;
  }

  /** Registra a chamada (append-only), a linha do tempo e devolve o payload público do painel. */
  private async recordCall(
    tx: Tx,
    actor: Actor,
    args: { entryId: string; attendanceId: string; room: { id: string; name: string }; callNumber: number; isRecall: boolean; outOfOrder: boolean; takeoverFrom?: string | null },
  ): Promise<PanelCallEvent> {
    const now = new Date();
    await tx.queueCall.create({
      data: { queueEntryId: args.entryId, attendanceId: args.attendanceId, roomId: args.room.id, calledById: actor.userId, callNumber: args.callNumber, isRecall: args.isRecall, outOfOrder: args.outOfOrder, calledAt: now },
    });
    await tx.attendance.updateMany({ where: { id: args.attendanceId, firstCalledAt: null }, data: { firstCalledAt: now } });
    const att = await tx.attendance.findUniqueOrThrow({ where: { id: args.attendanceId }, select: { code: true, ticketNumber: true, patientId: true } });
    await this.core.addEvent(tx, args.attendanceId, args.isRecall ? 'RECHAMADO' : 'CHAMADO', actor, { room: args.room.name, callNumber: args.callNumber });
    await this.audit.record(tx, actor, {
      action: args.isRecall ? 'PATIENT_RECALLED' : args.takeoverFrom ? 'PATIENT_CALL_TAKEN_OVER' : 'PATIENT_CALLED',
      entityType: 'QueueEntry',
      entityId: args.entryId,
      attendanceId: args.attendanceId,
      attendanceCode: att.code,
      patientId: att.patientId,
      metadata: { room: args.room.name, outOfOrder: args.outOfOrder || undefined, from: args.takeoverFrom ?? undefined },
    });
    return { ticket: formatTicket(att.ticketNumber), code: att.code, room: args.room.name, calledAt: now.toISOString(), recall: args.isRecall };
  }

  private mapUniqueViolation(e: unknown): never {
    const code = (e as { meta?: { code?: string } })?.meta?.code;
    if ((e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || code === '23505')) || /23505|unique/i.test(String((e as Error)?.message))) {
      throw conflict('Você ou este consultório já estão com um paciente chamado. Atualize a tela.', ErrorCodes.DOCTOR_BUSY);
    }
    throw e;
  }

  /** CHAMAR PRÓXIMO: escolhe e assume o primeiro da fila numa única instrução SQL (FOR UPDATE SKIP LOCKED). */
  async callNext(actor: Actor, roomId: string) {
    const event = await this.prisma
      .run(async (tx) => {
        const room = await this.assertCanTakePatient(tx, actor, roomId);
        const rows = await tx.$queryRaw<ClaimedRow[]>`
          UPDATE "queue"
             SET "status" = 'CALLED', "assigned_user_id" = ${actor.userId}::uuid, "room_id" = ${roomId}::uuid,
                 "called_at" = now(), "call_count" = "call_count" + 1, "version" = "version" + 1, "updated_at" = now()
           WHERE "id" = (
             SELECT "id" FROM "queue"
              WHERE "kind" = 'MEDICA' AND "status" = 'WAITING'
              ORDER BY "priority_score" ASC, "enqueued_at" ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED)
          RETURNING "id", "attendance_id", "call_count"`;
        if (rows.length === 0) throw conflict('Não há pacientes aguardando atendimento médico.', ErrorCodes.QUEUE_EMPTY);
        const r = rows[0];
        const panel = await this.recordCall(tx, actor, { entryId: r.id, attendanceId: r.attendance_id, room, callNumber: r.call_count, isRecall: false, outOfOrder: false });
        return { panel, attendanceId: r.attendance_id };
      })
      .catch((e) => this.mapUniqueViolation(e));
    this.afterCall(event.panel, event.attendanceId);
    return { attendanceId: event.attendanceId, ...event.panel };
  }

  /** Chamar um paciente específico da lista (fica registrado se foi fora da ordem da fila). */
  async callSpecific(actor: Actor, attendanceId: string, roomId: string, takeover: boolean) {
    const event = await this.prisma
      .run(async (tx) => {
        const entry = await tx.queueEntry.findUnique({
          where: { attendanceId_kind: { attendanceId, kind: 'MEDICA' } },
          include: { assignedUser: { select: { fullName: true } } },
        });
        if (!entry) throw notFound('Este atendimento não está na fila médica.');
        const room = await this.assertCanTakePatient(tx, actor, roomId, entry.id);
        const now = new Date();

        let takeoverFrom: string | null = null;
        const claimed = await tx.queueEntry.updateMany({
          where: { id: entry.id, status: 'WAITING' },
          data: { status: 'CALLED', assignedUserId: actor.userId, roomId, calledAt: now, callCount: { increment: 1 }, version: { increment: 1 } },
        });
        if (claimed.count === 0) {
          if (entry.status === 'CALLED' && entry.assignedUserId !== actor.userId) {
            const idle = minutesBetween(entry.calledAt ?? entry.updatedAt, now);
            if (!takeover || idle < CLAIM_STALE_MINUTES) {
              throw conflict(`Este paciente já foi chamado por ${entry.assignedUser?.fullName ?? 'outro médico'}.`, ErrorCodes.ALREADY_TAKEN, {
                by: entry.assignedUser?.fullName ?? null,
                idleMinutes: idle,
                canTakeOver: idle >= CLAIM_STALE_MINUTES,
              });
            }
            const taken = await tx.queueEntry.updateMany({
              where: { id: entry.id, version: entry.version, status: 'CALLED' },
              data: { assignedUserId: actor.userId, roomId, calledAt: now, callCount: { increment: 1 }, version: { increment: 1 } },
            });
            if (taken.count !== 1) throw conflict('Outro médico assumiu este paciente agora. Atualize a fila.', ErrorCodes.ALREADY_TAKEN);
            takeoverFrom = entry.assignedUser?.fullName ?? null;
          } else if (entry.assignedUserId === actor.userId) {
            throw conflict('Você já chamou este paciente. Use "Chamar novamente".', ErrorCodes.INVALID_STATE);
          } else {
            throw conflict(`Este paciente já está em atendimento com ${entry.assignedUser?.fullName ?? 'outro médico'}.`, ErrorCodes.ALREADY_TAKEN);
          }
        }

        const ahead = await tx.queueEntry.count({
          where: {
            kind: 'MEDICA',
            status: 'WAITING',
            id: { not: entry.id },
            OR: [{ priorityScore: { lt: entry.priorityScore } }, { priorityScore: entry.priorityScore, enqueuedAt: { lt: entry.enqueuedAt } }],
          },
        });
        const fresh = await tx.queueEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { callCount: true } });
        const panel = await this.recordCall(tx, actor, { entryId: entry.id, attendanceId, room, callNumber: fresh.callCount, isRecall: false, outOfOrder: ahead > 0, takeoverFrom });
        return { panel };
      })
      .catch((e) => this.mapUniqueViolation(e));
    this.afterCall(event.panel, attendanceId);
    return { attendanceId, ...event.panel };
  }

  private async myCalledEntry(tx: Tx, actor: Actor, attendanceId: string, statuses: ('CALLED' | 'IN_SERVICE')[]) {
    const entry = await tx.queueEntry.findUnique({ where: { attendanceId_kind: { attendanceId, kind: 'MEDICA' } }, include: { room: true } });
    if (!entry || !statuses.includes(entry.status as 'CALLED' | 'IN_SERVICE')) throw conflict('Este paciente não está chamado por você.', ErrorCodes.INVALID_STATE);
    if (entry.assignedUserId !== actor.userId) throw conflict('Este paciente está com outro médico.', ErrorCodes.ALREADY_TAKEN);
    return entry;
  }

  async recall(actor: Actor, attendanceId: string) {
    const panel = await this.prisma.run(async (tx) => {
      const entry = await this.myCalledEntry(tx, actor, attendanceId, ['CALLED']);
      const updated = await tx.queueEntry.update({ where: { id: entry.id }, data: { callCount: { increment: 1 }, calledAt: new Date(), version: { increment: 1 } } });
      return this.recordCall(tx, actor, { entryId: entry.id, attendanceId, room: entry.room!, callNumber: updated.callCount, isRecall: true, outOfOrder: false });
    });
    this.afterCall(panel, attendanceId);
    return { attendanceId, ...panel };
  }

  private afterCall(panel: PanelCallEvent, attendanceId: string): void {
    this.realtime.panelCall(panel);
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(attendanceId, 'AGUARDANDO_MEDICO');
  }

  /** Devolver à fila (paciente não compareceu à chamada). Mantém a posição original. */
  async release(actor: Actor, attendanceId: string, reason?: string) {
    await this.prisma.run(async (tx) => {
      const entry = await this.myCalledEntry(tx, actor, attendanceId, ['CALLED']);
      await tx.queueEntry.update({ where: { id: entry.id }, data: { status: 'WAITING', assignedUserId: null, roomId: null, calledAt: null, version: { increment: 1 } } });
      const att = await this.core.getRef(tx, attendanceId);
      await this.core.addEvent(tx, attendanceId, 'DEVOLVIDO_A_FILA', actor, { reason: reason ?? null });
      await this.audit.record(tx, actor, { action: 'PATIENT_RETURNED_TO_QUEUE', entityType: 'QueueEntry', entityId: entry.id, attendanceId, attendanceCode: att.code, patientId: att.patientId, metadata: { reason } });
    });
    this.realtime.queueChanged('MEDICA');
    return { attendanceId, status: 'AGUARDANDO_MEDICO' };
  }

  /** Paciente entrou no consultório: inicia o atendimento médico. */
  async start(actor: Actor, attendanceId: string) {
    await this.prisma.run(async (tx) => {
      const entry = await this.myCalledEntry(tx, actor, attendanceId, ['CALLED']);
      const att = await this.core.getRef(tx, attendanceId);
      const now = new Date();
      await tx.queueEntry.update({ where: { id: entry.id }, data: { status: 'IN_SERVICE', startedAt: now, version: { increment: 1 } } });
      await this.core.transition(tx, att, 'EM_ATENDIMENTO', actor, { data: { consultationStartedAt: now } });
      const source = await tx.attendance.findUniqueOrThrow({ where: { id: attendanceId }, select: { reason: true, triage: { select: { chiefComplaint: true } } } });
      // queixa já registrada na triagem vem pré-preenchida: o médico não redigita
      await tx.medicalConsultation.create({ data: { attendanceId, doctorId: actor.userId, startedAt: now, chiefComplaint: source.triage?.chiefComplaint ?? source.reason ?? null } });
      await this.core.addEvent(tx, attendanceId, 'ATENDIMENTO_INICIADO', actor, { room: entry.room?.name ?? null });
      await this.audit.record(tx, actor, { action: 'CONSULTATION_STARTED', entityType: 'Attendance', entityId: attendanceId, attendanceId, attendanceCode: att.code, patientId: att.patientId });
    });
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(attendanceId, 'EM_ATENDIMENTO');
    return this.get(actor, attendanceId, { audit: false });
  }

  // ───────────────────────────── prontuário do atendimento ─────────────────────────────

  async get(actor: Actor, attendanceId: string, opts: { audit: boolean } = { audit: true }) {
    const a = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        patient: { select: { id: true, recordNumber: true, fullName: true, socialName: true, birthDate: true, sex: true, motherName: true, cpf: true, cns: true } },
        accessibility: true,
        triage: { include: { finishedBy: { select: { fullName: true, professionalRegister: true } } } },
        vitals: { include: { recordedBy: { select: { fullName: true } } }, orderBy: { measuredAt: 'desc' } },
        classifications: { include: { classifiedBy: { select: { fullName: true, professionalRegister: true } } }, orderBy: { classifiedAt: 'desc' } },
        queueEntries: { where: { kind: 'MEDICA' }, include: { room: true, assignedUser: { select: { id: true, fullName: true } } } },
        consultation: {
          include: {
            doctor: { select: { id: true, fullName: true, professionalRegister: true } },
            diagnoses: { include: { createdBy: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
            prescription: { include: { items: { include: { createdBy: { select: { fullName: true } } }, orderBy: { position: 'asc' } } } },
            notes: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!a) throw notFound('Atendimento não encontrado.');
    const visible = MEDICAL_VISIBLE_STATUSES.includes(a.status) || (a.status === 'CANCELADO' && a.triageFinishedAt !== null);
    if (!visible) throw forbidden('Este atendimento ainda não chegou à etapa médica.');
    if (opts.audit) {
      await this.audit.record(this.prisma, actor, { action: 'CLINICAL_RECORD_VIEWED', entityType: 'Attendance', entityId: a.id, attendanceId: a.id, attendanceCode: a.code, patientId: a.patientId });
    }

    const entry = a.queueEntries[0];
    const c = a.consultation;
    const isMine = entry?.assignedUserId === actor.userId;
    const attending = c?.doctorId === actor.userId;
    const editable = EDITABLE.includes(a.status) && attending && can(actor, PERMISSIONS.MEDICAL_ATTEND);
    const current = a.classifications[0];
    const [versionList, timeline, previousCount] = await Promise.all([
      this.versions.list(this.prisma, a.id),
      this.attendances.timeline(actor, a.id),
      this.prisma.attendance.count({ where: { patientId: a.patientId, id: { not: a.id }, status: 'ATENDIMENTO_FINALIZADO' } }),
    ]);

    return {
      attendance: {
        id: a.id,
        code: a.code,
        ticket: formatTicket(a.ticketNumber),
        status: a.status,
        kind: a.kind,
        reason: a.reason,
        arrivedAt: a.arrivedAt.toISOString(),
        triageFinishedAt: a.triageFinishedAt?.toISOString() ?? null,
        consultationStartedAt: a.consultationStartedAt?.toISOString() ?? null,
        finishedAt: a.finishedAt?.toISOString() ?? null,
      },
      patient: { ...patientBasic(a.patient), motherName: a.patient.motherName, cpf: maskCpf(a.patient.cpf), cns: maskCns(a.patient.cns) },
      accessibility: accessibilityDto(a.accessibility, a.patient.birthDate),
      triage: a.triage
        ? {
            chiefComplaint: a.triage.chiefComplaint,
            symptoms: a.triage.symptoms,
            symptomOnset: a.triage.symptomOnset,
            allergies: a.triage.allergies,
            medicationsInUse: a.triage.medicationsInUse,
            notes: a.triage.notes,
            finishedBy: a.triage.finishedBy?.fullName ?? null,
            finishedByRegister: a.triage.finishedBy?.professionalRegister ?? null,
            finishedAt: a.triage.finishedAt?.toISOString() ?? null,
          }
        : null,
      latestVitals: a.vitals[0] ? vitalsDto(a.vitals[0]) : null,
      vitals: a.vitals.map(vitalsDto),
      risk: current
        ? {
            level: current.level,
            label: RISK_META[current.level].label,
            classifiedBy: current.classifiedBy.fullName,
            classifiedByRegister: current.classifiedBy.professionalRegister,
            classifiedAt: current.classifiedAt.toISOString(),
            protocol: current.protocol,
            observation: current.observation,
          }
        : null,
      classifications: a.classifications.map((x) => ({
        id: x.id, level: x.level, previousLevel: x.previousLevel, reason: x.reason, observation: x.observation,
        classifiedBy: x.classifiedBy.fullName, classifiedAt: x.classifiedAt.toISOString(),
      })),
      queue: entry
        ? { status: entry.status, room: entry.room ? { id: entry.room.id, name: entry.room.name } : null, assignedTo: entry.assignedUser ? { id: entry.assignedUser.id, name: entry.assignedUser.fullName } : null, isMine, calledAt: entry.calledAt?.toISOString() ?? null, callCount: entry.callCount }
        : null,
      consultation: c
        ? {
            id: c.id,
            status: c.status,
            doctor: { id: c.doctor.id, name: c.doctor.fullName, register: c.doctor.professionalRegister },
            chiefComplaint: c.chiefComplaint,
            history: c.history,
            examination: c.examination,
            conduct: c.conduct,
            outcome: c.outcome,
            outcomeLabel: c.outcome ? OUTCOME_LABELS[c.outcome] : null,
            finalNotes: c.finalNotes,
            version: c.version,
            startedAt: c.startedAt.toISOString(),
            finishedAt: c.finishedAt?.toISOString() ?? null,
          }
        : null,
      diagnoses: (c?.diagnoses ?? []).map((d) => ({
        id: d.id, code: d.code, description: d.description, isPrimary: d.isPrimary, createdBy: d.createdBy.fullName, createdAt: d.createdAt.toISOString(),
        removed: d.removedAt !== null, removedAt: d.removedAt?.toISOString() ?? null, removalReason: d.removalReason,
      })),
      prescriptionItems: (c?.prescription?.items ?? []).map((i) => ({
        id: i.id, position: i.position, medication: i.medication, dose: i.dose, route: i.route, frequency: i.frequency, duration: i.duration, notes: i.notes,
        createdBy: i.createdBy.fullName, createdAt: i.createdAt.toISOString(),
        canceled: i.canceledAt !== null, canceledAt: i.canceledAt?.toISOString() ?? null, cancelReason: i.cancelReason,
      })),
      notes: (c?.notes ?? []).map((n) => ({ id: n.id, type: n.type, content: n.content, author: n.author.fullName, createdAt: n.createdAt.toISOString() })),
      versions: versionList,
      timeline,
      previousAttendances: previousCount,
      permissions: {
        canStart: can(actor, PERMISSIONS.MEDICAL_ATTEND) && a.status === 'AGUARDANDO_MEDICO' && entry?.status === 'CALLED' && isMine,
        canRecall: a.status === 'AGUARDANDO_MEDICO' && entry?.status === 'CALLED' && isMine,
        canRelease: a.status === 'AGUARDANDO_MEDICO' && entry?.status === 'CALLED' && isMine,
        canEdit: editable,
        canPrescribe: editable,
        canFinish: editable,
        canReclassify: can(actor, PERMISSIONS.TRIAGE_CLASSIFY) && (a.status === 'AGUARDANDO_MEDICO' || editable),
        canCorrect: a.status === 'ATENDIMENTO_FINALIZADO' && can(actor, PERMISSIONS.MEDICAL_CORRECT),
        canAddNote: (a.status === 'ATENDIMENTO_FINALIZADO' && can(actor, PERMISSIONS.MEDICAL_CORRECT)) || editable,
        canViewHistory: can(actor, PERMISSIONS.CLINICAL_HISTORY_READ),
        canCancel: can(actor, PERMISSIONS.MEDICAL_ATTEND) && a.status === 'AGUARDANDO_MEDICO',
      },
    };
  }

  // ───────────────────────────── registro clínico ─────────────────────────────

  private async loadForWrite(tx: Tx, attendanceId: string) {
    const a = await tx.attendance.findUnique({ where: { id: attendanceId }, include: { consultation: true } });
    if (!a) throw notFound('Atendimento não encontrado.');
    if (!a.consultation) throw conflict('O atendimento médico ainda não foi iniciado.', ErrorCodes.INVALID_STATE);
    return { a, c: a.consultation };
  }

  private assertAttending(a: { status: string }, c: { doctorId: string }, actor: Actor): void {
    if (!EDITABLE.includes(a.status)) throw conflict('O atendimento não está em andamento.', ErrorCodes.INVALID_STATE);
    if (c.doctorId !== actor.userId) throw forbidden('Somente o médico responsável pode alterar este atendimento.');
  }

  /** Primeira medicação/conduta registrada → status MEDICACAO_REGISTRADA (uma única vez). */
  private async markMedicationRegistered(tx: Tx, a: { id: string; code: string; status: string }, actor: Actor, summary: string): Promise<boolean> {
    if (a.status !== 'EM_ATENDIMENTO') return false;
    await this.core.transition(tx, { id: a.id, code: a.code, status: 'EM_ATENDIMENTO' }, 'MEDICACAO_REGISTRADA', actor, { data: { medicationRegisteredAt: new Date() } });
    await this.core.addEvent(tx, a.id, 'MEDICACAO_REGISTRADA', actor, { summary });
    return true;
  }

  async saveConsultation(actor: Actor, attendanceId: string, input: SaveConsultationInput) {
    const changedStatus = await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      let isCorrection = false;
      if (a.status === 'ATENDIMENTO_FINALIZADO') {
        if (!can(actor, PERMISSIONS.MEDICAL_CORRECT)) throw forbidden('Você não pode corrigir atendimentos finalizados.');
        if (!input.correctionReason) throw unprocessable('Informe o motivo da correção.', ErrorCodes.VALIDATION);
        isCorrection = true;
      } else {
        this.assertAttending(a, c, actor);
      }
      if (c.version !== input.expectedVersion) throw conflict('O atendimento foi alterado em outra tela. Recarregue antes de salvar.', ErrorCodes.EDIT_CONFLICT);

      const next: ConsultationText = {
        chiefComplaint: input.chiefComplaint ?? null,
        history: input.history ?? null,
        examination: input.examination ?? null,
        conduct: input.conduct ?? null,
      };
      const fields = changedFields(c as unknown as ConsultationText, next, [...CONSULTATION_TEXT_FIELDS]);
      if (fields.length === 0) return false;

      await this.versions.archive(tx, {
        attendanceId, recordType: 'CONSULTA', recordId: c.id, version: c.version,
        snapshot: { ...Object.fromEntries(CONSULTATION_TEXT_FIELDS.map((f) => [f, c[f]])), outcome: c.outcome, finalNotes: c.finalNotes, status: c.status },
        actor, reason: input.correctionReason ?? null,
      });
      const res = await tx.medicalConsultation.updateMany({ where: { id: c.id, version: c.version }, data: { ...next, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('O atendimento foi alterado em outra tela. Recarregue antes de salvar.', ErrorCodes.EDIT_CONFLICT);

      let statusChanged = false;
      if (!isCorrection && next.conduct && !c.conduct) statusChanged = await this.markMedicationRegistered(tx, a, actor, 'Conduta registrada');
      if (isCorrection) {
        await tx.medicalNote.create({ data: { consultationId: c.id, attendanceId, type: 'CORRECAO', content: `Correção (${fields.join(', ')}): ${input.correctionReason}`, authorId: actor.userId } });
        await this.core.addEvent(tx, attendanceId, 'REGISTRO_CORRIGIDO', actor, { summary: 'Atendimento médico corrigido', reason: input.correctionReason, fields });
      }
      await this.audit.record(tx, actor, {
        action: isCorrection ? 'CONSULTATION_CORRECTED' : 'CONSULTATION_UPDATED',
        entityType: 'MedicalConsultation', entityId: c.id, attendanceId, attendanceCode: a.code, patientId: a.patientId,
        changes: { fields }, metadata: { version: c.version + 1 },
      });
      return statusChanged;
    });
    if (changedStatus) this.realtime.attendanceChanged(attendanceId, 'MEDICACAO_REGISTRADA');
    return this.get(actor, attendanceId, { audit: false });
  }

  async addDiagnosis(actor: Actor, attendanceId: string, input: AddDiagnosisInput) {
    await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      this.assertAttending(a, c, actor);
      if (input.isPrimary) await tx.diagnosis.updateMany({ where: { consultationId: c.id, isPrimary: true, removedAt: null }, data: { isPrimary: false } });
      const d = await tx.diagnosis.create({ data: { consultationId: c.id, attendanceId, code: input.code ?? null, description: input.description, isPrimary: input.isPrimary, createdById: actor.userId } });
      await this.core.addEvent(tx, attendanceId, 'DIAGNOSTICO_REGISTRADO', actor, { summary: input.code ? `${input.code} — ${input.description}` : input.description });
      await this.audit.record(tx, actor, { action: 'DIAGNOSIS_ADDED', entityType: 'Diagnosis', entityId: d.id, attendanceId, attendanceCode: a.code, patientId: a.patientId });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  async removeDiagnosis(actor: Actor, attendanceId: string, diagnosisId: string, reason: string) {
    await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      this.assertAttending(a, c, actor);
      const res = await tx.diagnosis.updateMany({ where: { id: diagnosisId, consultationId: c.id, removedAt: null }, data: { removedAt: new Date(), removedById: actor.userId, removalReason: reason, isPrimary: false } });
      if (res.count !== 1) throw notFound('Diagnóstico não encontrado.');
      await this.audit.record(tx, actor, { action: 'DIAGNOSIS_REMOVED', entityType: 'Diagnosis', entityId: diagnosisId, attendanceId, attendanceCode: a.code, patientId: a.patientId, metadata: { reason } });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  /** O sistema NÃO prescreve: apenas registra o que o médico responsável decidiu. */
  async addPrescriptionItem(actor: Actor, attendanceId: string, input: PrescriptionItemInput) {
    const changedStatus = await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      this.assertAttending(a, c, actor);
      const prescription = await tx.prescription.upsert({
        where: { consultationId: c.id },
        create: { consultationId: c.id, attendanceId, prescribedById: actor.userId },
        update: {},
      });
      const count = await tx.prescriptionItem.count({ where: { prescriptionId: prescription.id } });
      const item = await tx.prescriptionItem.create({
        data: { prescriptionId: prescription.id, position: count + 1, medication: input.medication, dose: input.dose, route: input.route, frequency: input.frequency, duration: input.duration, notes: input.notes ?? null, createdById: actor.userId },
      });
      const changed = await this.markMedicationRegistered(tx, a, actor, 'Medicação prescrita');
      await this.audit.record(tx, actor, { action: 'PRESCRIPTION_ITEM_ADDED', entityType: 'PrescriptionItem', entityId: item.id, attendanceId, attendanceCode: a.code, patientId: a.patientId });
      return changed;
    });
    if (changedStatus) this.realtime.attendanceChanged(attendanceId, 'MEDICACAO_REGISTRADA');
    return this.get(actor, attendanceId, { audit: false });
  }

  async cancelPrescriptionItem(actor: Actor, attendanceId: string, itemId: string, reason: string) {
    await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      this.assertAttending(a, c, actor);
      const res = await tx.prescriptionItem.updateMany({
        where: { id: itemId, canceledAt: null, prescription: { consultationId: c.id } },
        data: { canceledAt: new Date(), canceledById: actor.userId, cancelReason: reason },
      });
      if (res.count !== 1) throw notFound('Item de prescrição não encontrado.');
      await this.audit.record(tx, actor, { action: 'PRESCRIPTION_ITEM_CANCELED', entityType: 'PrescriptionItem', entityId: itemId, attendanceId, attendanceCode: a.code, patientId: a.patientId, metadata: { reason } });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  async finish(actor: Actor, attendanceId: string, input: FinishConsultationInput) {
    await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      this.assertAttending(a, c, actor);
      if (input.expectedVersion !== undefined && input.expectedVersion !== c.version) {
        throw conflict('O atendimento foi alterado em outra tela. Recarregue antes de finalizar.', ErrorCodes.EDIT_CONFLICT);
      }
      const activeItems = await tx.prescriptionItem.count({ where: { canceledAt: null, prescription: { consultationId: c.id } } });
      if (input.outcome === 'MEDICADO' && activeItems === 0) throw unprocessable('Para o desfecho "Medicado", registre ao menos uma medicação.', 'MEDICATION_REQUIRED');
      if (input.outcome === 'OUTRO' && !input.finalNotes) throw unprocessable('Para o desfecho "Outro", descreva nas observações finais.', 'FINAL_NOTES_REQUIRED');
      if (!c.conduct && !input.finalNotes && activeItems === 0) throw unprocessable('Registre a conduta, uma medicação ou as observações finais antes de finalizar.', 'CONDUCT_REQUIRED');

      const now = new Date();
      await this.versions.archive(tx, {
        attendanceId, recordType: 'CONSULTA', recordId: c.id, version: c.version,
        snapshot: { ...Object.fromEntries(CONSULTATION_TEXT_FIELDS.map((f) => [f, c[f]])), outcome: c.outcome, finalNotes: c.finalNotes, status: c.status },
        actor, reason: 'Finalização do atendimento',
      });
      const res = await tx.medicalConsultation.updateMany({
        where: { id: c.id, version: c.version, status: 'IN_PROGRESS' },
        data: { status: 'FINISHED', outcome: input.outcome, finalNotes: input.finalNotes ?? null, finishedAt: now, version: { increment: 1 } },
      });
      if (res.count !== 1) throw conflict('O atendimento foi alterado em outra tela. Recarregue antes de finalizar.', ErrorCodes.EDIT_CONFLICT);
      await this.core.transition(tx, a, 'ATENDIMENTO_FINALIZADO', actor, { data: { finishedAt: now } });
      await tx.queueEntry.updateMany({ where: { attendanceId, kind: 'MEDICA', status: 'IN_SERVICE' }, data: { status: 'DONE', finishedAt: now } });
      await this.core.addEvent(tx, attendanceId, 'ATENDIMENTO_FINALIZADO', actor, { outcome: input.outcome, outcomeLabel: OUTCOME_LABELS[input.outcome] });
      await this.audit.record(tx, actor, { action: 'CONSULTATION_FINISHED', entityType: 'MedicalConsultation', entityId: c.id, attendanceId, attendanceCode: a.code, patientId: a.patientId, metadata: { outcome: input.outcome } });
    });
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(attendanceId, 'ATENDIMENTO_FINALIZADO');
    return this.get(actor, attendanceId, { audit: false });
  }

  async addNote(actor: Actor, attendanceId: string, content: string) {
    await this.prisma.run(async (tx) => {
      const { a, c } = await this.loadForWrite(tx, attendanceId);
      if (a.status === 'ATENDIMENTO_FINALIZADO') {
        if (!can(actor, PERMISSIONS.MEDICAL_CORRECT)) throw forbidden('Você não pode complementar atendimentos finalizados.');
      } else {
        this.assertAttending(a, c, actor);
      }
      const n = await tx.medicalNote.create({ data: { consultationId: c.id, attendanceId, type: 'COMPLEMENTO', content, authorId: actor.userId } });
      await this.core.addEvent(tx, attendanceId, 'COMPLEMENTO_REGISTRADO', actor);
      await this.audit.record(tx, actor, { action: 'MEDICAL_NOTE_ADDED', entityType: 'MedicalNote', entityId: n.id, attendanceId, attendanceCode: a.code, patientId: a.patientId });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  // ───────────────────────────── histórico e versões ─────────────────────────────

  /** Atendimentos anteriores FINALIZADOS do paciente (o "histórico disponível" do médico). */
  async patientHistory(actor: Actor, attendanceId: string) {
    const current = await this.prisma.attendance.findUnique({ where: { id: attendanceId }, select: { patientId: true, code: true } });
    if (!current) throw notFound('Atendimento não encontrado.');
    const rows = await this.prisma.attendance.findMany({
      where: { patientId: current.patientId, id: { not: attendanceId }, status: 'ATENDIMENTO_FINALIZADO' },
      orderBy: { arrivedAt: 'desc' },
      take: 20,
      include: {
        triage: { select: { chiefComplaint: true, allergies: true } },
        consultation: {
          include: {
            doctor: { select: { fullName: true } },
            diagnoses: { where: { removedAt: null } },
            prescription: { include: { items: { where: { canceledAt: null }, orderBy: { position: 'asc' } } } },
          },
        },
      },
    });
    await this.audit.record(this.prisma, actor, { action: 'CLINICAL_HISTORY_VIEWED', entityType: 'Patient', entityId: current.patientId, patientId: current.patientId, attendanceId, attendanceCode: current.code, metadata: { results: rows.length } });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      arrivedAt: r.arrivedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      riskLevel: r.currentRiskLevel,
      chiefComplaint: r.consultation?.chiefComplaint ?? r.triage?.chiefComplaint ?? r.reason,
      allergies: r.triage?.allergies ?? null,
      doctor: r.consultation?.doctor.fullName ?? null,
      outcome: r.consultation?.outcome ?? null,
      outcomeLabel: r.consultation?.outcome ? OUTCOME_LABELS[r.consultation.outcome] : null,
      conduct: r.consultation?.conduct ?? null,
      diagnoses: (r.consultation?.diagnoses ?? []).map((d) => ({ code: d.code, description: d.description, isPrimary: d.isPrimary })),
      medications: (r.consultation?.prescription?.items ?? []).map((i) => ({ medication: i.medication, dose: i.dose, route: i.route, frequency: i.frequency, duration: i.duration })),
    }));
  }

  async getVersion(actor: Actor, attendanceId: string, versionId: string) {
    const v = await this.prisma.clinicalRecordVersion.findFirst({ where: { id: versionId, attendanceId }, include: { changedBy: { select: { fullName: true } }, attendance: { select: { code: true, patientId: true } } } });
    if (!v) throw notFound('Versão não encontrada.');
    await this.audit.record(this.prisma, actor, { action: 'CLINICAL_VERSION_VIEWED', entityType: 'ClinicalRecordVersion', entityId: v.id, attendanceId, attendanceCode: v.attendance.code, patientId: v.attendance.patientId });
    return { id: v.id, recordType: v.recordType, version: v.version, snapshot: v.snapshot, changedBy: v.changedBy.fullName, changeReason: v.changeReason, createdAt: v.createdAt.toISOString() };
  }
}
