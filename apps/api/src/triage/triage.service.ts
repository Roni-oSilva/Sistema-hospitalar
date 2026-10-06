import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CLAIM_STALE_MINUTES,
  ClassifyInput,
  PERMISSIONS,
  RISK_META,
  SaveTriageInput,
  VitalsInput,
  minutesBetween,
} from '@hospital/shared';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AttendanceCoreService } from '../attendances/attendance-core.service';
import { QueuePriorityService } from '../queue/queue-priority.service';
import { ClinicalVersioningService, changedFields } from '../clinical/clinical-versioning.service';
import { Actor, can } from '../auth/auth.types';
import { ErrorCodes, conflict, forbidden, notFound, unprocessable } from '../common/errors/app-error';
import { formatTicket } from '../common/sequence.service';
import { accessibilityDto, decimalToNumber, patientBasic } from '../attendances/attendance.mapper';

const TRIAGE_TEXT_FIELDS = ['chiefComplaint', 'symptoms', 'symptomOnset', 'allergies', 'medicationsInUse', 'notes'] as const;
type TriageText = Record<(typeof TRIAGE_TEXT_FIELDS)[number], string | null>;

/** Status em que a equipe de triagem (sem permissão de consulta) ainda pode abrir a triagem. */
const TRIAGE_VISIBLE_STATUSES = ['AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO'];

export function vitalsDto(v: {
  id: string; measuredAt: Date; systolic: number | null; diastolic: number | null; heartRate: number | null; respiratoryRate: number | null;
  spo2: number | null; temperatureC: Prisma.Decimal | null; glucose: number | null; weightKg: Prisma.Decimal | null; heightCm: Prisma.Decimal | null;
  painScale: number | null; recordedBy?: { fullName: string } | null;
}) {
  const weight = decimalToNumber(v.weightKg);
  const height = decimalToNumber(v.heightCm);
  return {
    id: v.id,
    measuredAt: v.measuredAt.toISOString(),
    recordedBy: v.recordedBy?.fullName ?? null,
    bloodPressure: v.systolic !== null && v.diastolic !== null ? `${v.systolic}/${v.diastolic}` : null,
    systolic: v.systolic,
    diastolic: v.diastolic,
    heartRate: v.heartRate,
    respiratoryRate: v.respiratoryRate,
    spo2: v.spo2,
    temperatureC: decimalToNumber(v.temperatureC),
    glucose: v.glucose,
    weightKg: weight,
    heightCm: height,
    bmi: weight && height ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : null,
    painScale: v.painScale,
  };
}

@Injectable()
export class TriageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: AttendanceCoreService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly priority: QueuePriorityService,
    private readonly versions: ClinicalVersioningService,
  ) {}

  // ───────────────────────────── fila ─────────────────────────────

  async queue(actor: Actor) {
    const entries = await this.prisma.queueEntry.findMany({
      where: { kind: 'TRIAGEM', status: { in: ['WAITING', 'IN_SERVICE'] } },
      include: {
        assignedUser: { select: { id: true, fullName: true } },
        attendance: {
          include: {
            patient: { select: { id: true, recordNumber: true, fullName: true, socialName: true, birthDate: true, sex: true } },
            accessibility: true,
          },
        },
      },
      orderBy: [{ priorityScore: 'asc' }, { enqueuedAt: 'asc' }],
    });
    const now = new Date();
    const items = entries.map((e) => ({
      attendanceId: e.attendanceId,
      code: e.attendance.code,
      ticket: formatTicket(e.attendance.ticketNumber),
      status: e.attendance.status,
      queueStatus: e.status,
      arrivedAt: e.attendance.arrivedAt.toISOString(),
      waitingMinutes: minutesBetween(e.attendance.arrivedAt, now),
      reason: e.attendance.reason,
      // cor só existe DEPOIS da classificação (ex.: paciente devolvido à fila); a fila de triagem é por chegada
      riskLevel: e.attendance.currentRiskLevel,
      patient: patientBasic(e.attendance.patient, now),
      accessibility: accessibilityDto(e.attendance.accessibility, e.attendance.patient.birthDate),
      assignedTo: e.assignedUser ? { id: e.assignedUser.id, name: e.assignedUser.fullName, isMe: e.assignedUser.id === actor.userId } : null,
      startedAt: e.startedAt?.toISOString() ?? null,
    }));
    return {
      waiting: items.filter((i) => i.queueStatus === 'WAITING'),
      inProgress: items.filter((i) => i.queueStatus === 'IN_SERVICE'),
    };
  }

  // ───────────────────────────── iniciar (claim atômico) ─────────────────────────────

  private async lastActivity(tx: Tx, attendanceId: string, startedAt: Date | null): Promise<Date> {
    const [triage, vital, cls] = await Promise.all([
      tx.triage.findUnique({ where: { attendanceId }, select: { updatedAt: true } }),
      tx.triageVital.findFirst({ where: { attendanceId }, orderBy: { measuredAt: 'desc' }, select: { measuredAt: true } }),
      tx.riskClassification.findFirst({ where: { attendanceId }, orderBy: { classifiedAt: 'desc' }, select: { classifiedAt: true } }),
    ]);
    const dates = [startedAt, triage?.updatedAt, vital?.measuredAt, cls?.classifiedAt].filter((d): d is Date => Boolean(d));
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  async start(actor: Actor, attendanceId: string, takeover: boolean) {
    const result = await this.prisma.run(async (tx) => {
      const att = await this.core.getRef(tx, attendanceId);
      const now = new Date();

      // UPDATE … WHERE status = 'WAITING': entre dois profissionais clicando juntos, só um vence.
      const claimed = await tx.queueEntry.updateMany({
        where: { attendanceId, kind: 'TRIAGEM', status: 'WAITING' },
        data: { status: 'IN_SERVICE', assignedUserId: actor.userId, startedAt: now, version: { increment: 1 } },
      });

      let resumed = false;
      let tookOverFrom: string | null = null;
      if (claimed.count === 0) {
        const entry = await tx.queueEntry.findUnique({
          where: { attendanceId_kind: { attendanceId, kind: 'TRIAGEM' } },
          include: { assignedUser: { select: { fullName: true } } },
        });
        if (!entry) throw notFound('Atendimento não está na fila de triagem.');
        if (entry.status !== 'IN_SERVICE') throw conflict('Este atendimento não está mais aguardando triagem.', ErrorCodes.INVALID_STATE);
        if (entry.assignedUserId === actor.userId) {
          resumed = true; // mesmo profissional reabrindo a própria triagem (ex.: fechou o navegador)
        } else {
          const idle = minutesBetween(await this.lastActivity(tx, attendanceId, entry.startedAt), now);
          const stale = idle >= CLAIM_STALE_MINUTES;
          if (!takeover || !stale) {
            throw conflict(`Este paciente já está em triagem com ${entry.assignedUser?.fullName ?? 'outro profissional'}.`, ErrorCodes.ALREADY_TAKEN, {
              by: entry.assignedUser?.fullName ?? null,
              idleMinutes: idle,
              canTakeOver: stale,
            });
          }
          const taken = await tx.queueEntry.updateMany({
            where: { id: entry.id, version: entry.version, status: 'IN_SERVICE' },
            data: { assignedUserId: actor.userId, startedAt: now, version: { increment: 1 } },
          });
          if (taken.count !== 1) throw conflict('Outro profissional assumiu este paciente agora. Atualize a fila.', ErrorCodes.ALREADY_TAKEN);
          tookOverFrom = entry.assignedUser?.fullName ?? null;
        }
      }

      if (!resumed && !tookOverFrom) {
        const first = await tx.attendance.findUniqueOrThrow({ where: { id: attendanceId }, select: { triageStartedAt: true } });
        await this.core.transition(tx, att, 'EM_TRIAGEM', actor, { data: first.triageStartedAt ? {} : { triageStartedAt: now } });
        await this.core.addEvent(tx, attendanceId, 'TRIAGEM_INICIADA', actor);
      }

      const existing = await tx.triage.findUnique({ where: { attendanceId } });
      if (!existing) {
        await tx.triage.create({ data: { attendanceId, startedById: actor.userId, startedAt: now } });
      } else if (!resumed) {
        await tx.triage.update({ where: { id: existing.id }, data: { startedById: actor.userId, startedAt: now } });
      }

      if (!resumed) {
        await this.audit.record(tx, actor, {
          action: tookOverFrom ? 'TRIAGE_TAKEN_OVER' : 'TRIAGE_STARTED',
          entityType: 'Attendance',
          entityId: attendanceId,
          attendanceId,
          attendanceCode: att.code,
          patientId: att.patientId,
          ...(tookOverFrom ? { metadata: { from: tookOverFrom } } : {}),
        });
      }
      return { resumed };
    });
    if (!result.resumed) {
      this.realtime.queueChanged('TRIAGEM');
      this.realtime.attendanceChanged(attendanceId, 'EM_TRIAGEM');
    }
    return this.get(actor, attendanceId, { audit: false });
  }

  // ───────────────────────────── leitura ─────────────────────────────

  async get(actor: Actor, attendanceId: string, opts: { audit: boolean } = { audit: true }) {
    const a = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        patient: { select: { id: true, recordNumber: true, fullName: true, socialName: true, birthDate: true, sex: true } },
        accessibility: true,
        triage: { include: { startedBy: { select: { fullName: true } }, finishedBy: { select: { fullName: true } } } },
        vitals: { include: { recordedBy: { select: { fullName: true } } }, orderBy: { measuredAt: 'desc' } },
        classifications: { include: { classifiedBy: { select: { fullName: true, professionalRegister: true } } }, orderBy: { classifiedAt: 'desc' } },
        queueEntries: { include: { assignedUser: { select: { id: true, fullName: true } } } },
      },
    });
    if (!a) throw notFound('Atendimento não encontrado.');
    if (!can(actor, PERMISSIONS.CONSULTATION_READ) && !TRIAGE_VISIBLE_STATUSES.includes(a.status)) {
      throw forbidden('A triagem deste atendimento já foi encerrada e não está mais disponível para o seu perfil.');
    }
    if (opts.audit) {
      await this.audit.record(this.prisma, actor, { action: 'TRIAGE_VIEWED', entityType: 'Triage', entityId: a.triage?.id ?? null, attendanceId, attendanceCode: a.code, patientId: a.patientId });
    }

    const triageEntry = a.queueEntries.find((q) => q.kind === 'TRIAGEM');
    const medicalEntry = a.queueEntries.find((q) => q.kind === 'MEDICA');
    const isHolder = triageEntry?.status === 'IN_SERVICE' && triageEntry.assignedUserId === actor.userId;
    const performer = can(actor, PERMISSIONS.TRIAGE_PERFORM);
    const canCorrect = performer && a.status === 'AGUARDANDO_MEDICO' && medicalEntry?.status === 'WAITING';
    const t = a.triage;

    return {
      attendance: {
        id: a.id,
        code: a.code,
        ticket: formatTicket(a.ticketNumber),
        status: a.status,
        kind: a.kind,
        reason: a.reason,
        arrivedAt: a.arrivedAt.toISOString(),
        version: a.version,
      },
      patient: patientBasic(a.patient),
      accessibility: accessibilityDto(a.accessibility, a.patient.birthDate),
      queue: triageEntry
        ? { status: triageEntry.status, assignedTo: triageEntry.assignedUser ? { id: triageEntry.assignedUser.id, name: triageEntry.assignedUser.fullName } : null, isMine: isHolder }
        : null,
      triage: t
        ? {
            id: t.id,
            status: t.status,
            chiefComplaint: t.chiefComplaint,
            symptoms: t.symptoms,
            symptomOnset: t.symptomOnset,
            allergies: t.allergies,
            medicationsInUse: t.medicationsInUse,
            notes: t.notes,
            version: t.version,
            startedBy: t.startedBy.fullName,
            startedAt: t.startedAt.toISOString(),
            finishedBy: t.finishedBy?.fullName ?? null,
            finishedAt: t.finishedAt?.toISOString() ?? null,
          }
        : null,
      /** Sugestão: o motivo informado na recepção pré-preenche a queixa (ninguém digita duas vezes). */
      suggestedChiefComplaint: a.reason,
      vitals: a.vitals.map(vitalsDto),
      classifications: a.classifications.map((c) => ({
        id: c.id,
        level: c.level,
        label: RISK_META[c.level].label,
        previousLevel: c.previousLevel,
        protocol: c.protocol,
        observation: c.observation,
        reason: c.reason,
        classifiedBy: c.classifiedBy.fullName,
        classifiedByRegister: c.classifiedBy.professionalRegister,
        classifiedAt: c.classifiedAt.toISOString(),
      })),
      currentRiskLevel: a.currentRiskLevel,
      protocolName: await this.settings.get('triage.protocol_name'),
      permissions: {
        canEdit: performer && a.status === 'EM_TRIAGEM' && isHolder,
        canCorrect,
        canAddVitals: performer && ((a.status === 'EM_TRIAGEM' && isHolder) || a.status === 'AGUARDANDO_MEDICO'),
        canClassify: can(actor, PERMISSIONS.TRIAGE_CLASSIFY) && ((a.status === 'EM_TRIAGEM' && isHolder) || a.status === 'AGUARDANDO_MEDICO'),
        canFinish: performer && a.status === 'EM_TRIAGEM' && isHolder && a.currentRiskLevel !== null,
        canRelease: performer && a.status === 'EM_TRIAGEM' && isHolder,
        canStart: performer && (a.status === 'AGUARDANDO_TRIAGEM' || (a.status === 'EM_TRIAGEM' && !isHolder)),
        canEditAccessibility: can(actor, PERMISSIONS.ACCESSIBILITY_WRITE) && ['AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'].includes(a.status),
      },
    };
  }

  // ───────────────────────────── escrita ─────────────────────────────

  /** Garante que o ator é quem está com o paciente na triagem. */
  private async assertHolder(tx: Tx, attendanceId: string, actor: Actor): Promise<void> {
    const entry = await tx.queueEntry.findUnique({ where: { attendanceId_kind: { attendanceId, kind: 'TRIAGEM' } }, include: { assignedUser: { select: { fullName: true } } } });
    if (!entry || entry.status !== 'IN_SERVICE') throw conflict('A triagem deste paciente não está em andamento.', ErrorCodes.INVALID_STATE);
    if (entry.assignedUserId !== actor.userId) {
      throw conflict(`Este paciente está em triagem com ${entry.assignedUser?.fullName ?? 'outro profissional'}.`, ErrorCodes.ALREADY_TAKEN);
    }
  }

  private async assertCorrectionWindow(tx: Tx, attendanceId: string): Promise<void> {
    const medical = await tx.queueEntry.findUnique({ where: { attendanceId_kind: { attendanceId, kind: 'MEDICA' } } });
    if (!medical || medical.status !== 'WAITING') {
      throw conflict('O médico já chamou o paciente: a triagem não pode mais ser alterada.', ErrorCodes.INVALID_STATE);
    }
  }

  async save(actor: Actor, attendanceId: string, input: SaveTriageInput) {
    await this.prisma.run(async (tx) => {
      const att = await this.core.getRef(tx, attendanceId);
      const triage = await tx.triage.findUnique({ where: { attendanceId } });
      if (!triage) throw conflict('A triagem ainda não foi iniciada.', ErrorCodes.INVALID_STATE);

      let isCorrection = false;
      if (att.status === 'EM_TRIAGEM') {
        await this.assertHolder(tx, attendanceId, actor);
      } else if (att.status === 'AGUARDANDO_MEDICO') {
        await this.assertCorrectionWindow(tx, attendanceId);
        if (!input.correctionReason) throw unprocessable('Informe o motivo da correção da triagem.', ErrorCodes.VALIDATION);
        isCorrection = true;
      } else {
        throw conflict('A triagem não pode ser alterada nesta etapa do atendimento.', ErrorCodes.INVALID_STATE);
      }
      if (triage.version !== input.expectedVersion) {
        throw conflict('A triagem foi alterada em outra tela. Recarregue antes de salvar.', ErrorCodes.EDIT_CONFLICT);
      }

      const next: TriageText = {
        chiefComplaint: input.chiefComplaint ?? null,
        symptoms: input.symptoms ?? null,
        symptomOnset: input.symptomOnset ?? null,
        allergies: input.allergies ?? null,
        medicationsInUse: input.medicationsInUse ?? null,
        notes: input.notes ?? null,
      };
      const fields = changedFields(triage as unknown as TriageText, next, [...TRIAGE_TEXT_FIELDS]);
      if (fields.length === 0) return;

      // versão anterior arquivada ANTES do update (o trigger do banco exige)
      await this.versions.archive(tx, {
        attendanceId,
        recordType: 'TRIAGEM',
        recordId: triage.id,
        version: triage.version,
        snapshot: Object.fromEntries(TRIAGE_TEXT_FIELDS.map((f) => [f, triage[f]])),
        actor,
        reason: input.correctionReason ?? null,
      });
      const res = await tx.triage.updateMany({ where: { id: triage.id, version: triage.version }, data: { ...next, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('A triagem foi alterada em outra tela. Recarregue antes de salvar.', ErrorCodes.EDIT_CONFLICT);

      if (isCorrection) await this.core.addEvent(tx, attendanceId, 'REGISTRO_CORRIGIDO', actor, { summary: 'Triagem corrigida', reason: input.correctionReason, fields });
      await this.audit.record(tx, actor, {
        action: isCorrection ? 'TRIAGE_CORRECTED' : 'TRIAGE_UPDATED',
        entityType: 'Triage',
        entityId: triage.id,
        attendanceId,
        attendanceCode: att.code,
        patientId: att.patientId,
        changes: { fields },
        metadata: { version: triage.version + 1 },
      });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  async addVitals(actor: Actor, attendanceId: string, input: VitalsInput) {
    await this.prisma.run(async (tx) => {
      const att = await this.core.getRef(tx, attendanceId);
      if (att.status === 'EM_TRIAGEM') await this.assertHolder(tx, attendanceId, actor);
      else if (att.status !== 'AGUARDANDO_MEDICO') throw conflict('Sinais vitais só podem ser registrados durante a triagem ou enquanto o paciente aguarda o médico.', ErrorCodes.INVALID_STATE);
      const triage = await tx.triage.findUnique({ where: { attendanceId } });
      if (!triage) throw conflict('A triagem ainda não foi iniciada.', ErrorCodes.INVALID_STATE);
      const v = await tx.triageVital.create({
        data: {
          triageId: triage.id,
          attendanceId,
          recordedById: actor.userId,
          systolic: input.systolic ?? null,
          diastolic: input.diastolic ?? null,
          heartRate: input.heartRate ?? null,
          respiratoryRate: input.respiratoryRate ?? null,
          spo2: input.spo2 ?? null,
          temperatureC: input.temperatureC ?? null,
          glucose: input.glucose ?? null,
          weightKg: input.weightKg ?? null,
          heightCm: input.heightCm ?? null,
          painScale: input.painScale ?? null,
        },
      });
      await this.audit.record(tx, actor, {
        action: att.status === 'EM_TRIAGEM' ? 'VITALS_RECORDED' : 'VITALS_REASSESSED',
        entityType: 'TriageVital',
        entityId: v.id,
        attendanceId,
        attendanceCode: att.code,
        patientId: att.patientId,
        changes: { fields: Object.entries(input).filter(([, val]) => val !== undefined).map(([k]) => k) },
      });
    });
    return this.get(actor, attendanceId, { audit: false });
  }

  /**
   * Classificação de risco — SEMPRE decisão do profissional (o sistema não sugere nem decide).
   * Registra nível, profissional, data/hora, observação e o protocolo configurado. Histórico append-only.
   */
  async classify(actor: Actor, attendanceId: string, input: ClassifyInput) {
    const out = await this.prisma.run(async (tx) => {
      const a = await tx.attendance.findUnique({
        where: { id: attendanceId },
        include: { accessibility: true, patient: { select: { birthDate: true } }, triage: true, consultation: { select: { doctorId: true } } },
      });
      if (!a) throw notFound('Atendimento não encontrado.');
      if (!a.triage) throw conflict('A triagem ainda não foi iniciada.', ErrorCodes.INVALID_STATE);

      const duringTriage = a.status === 'EM_TRIAGEM';
      if (duringTriage) {
        await this.assertHolder(tx, attendanceId, actor);
      } else if (a.status === 'AGUARDANDO_MEDICO') {
        // reclassificação antes do atendimento (triagem ou médico)
      } else if (a.status === 'EM_ATENDIMENTO' || a.status === 'MEDICACAO_REGISTRADA') {
        if (a.consultation?.doctorId !== actor.userId) throw forbidden('Somente o médico responsável pelo atendimento pode reclassificar agora.');
      } else {
        throw conflict('A classificação não pode ser alterada nesta etapa do atendimento.', ErrorCodes.INVALID_STATE);
      }
      const isReclassification = !duringTriage && a.currentRiskLevel !== null;
      if (isReclassification && !input.reason) throw unprocessable('Informe o motivo da reclassificação.', ErrorCodes.VALIDATION);
      if (a.currentRiskLevel === input.level && !input.observation) return { changed: false, status: a.status, code: a.code };

      const protocol = await this.settings.get('triage.protocol_name');
      const now = new Date();
      await tx.riskClassification.create({
        data: {
          attendanceId,
          triageId: a.triage.id,
          level: input.level,
          previousLevel: a.currentRiskLevel,
          protocol,
          observation: input.observation ?? null,
          reason: input.reason ?? null,
          classifiedById: actor.userId,
          classifiedAt: now,
        },
      });
      await tx.attendance.update({ where: { id: attendanceId }, data: { currentRiskLevel: input.level, riskClassifiedAt: now, version: { increment: 1 } } });
      await this.priority.refresh(tx, attendanceId, input.level, a.accessibility?.flags ?? [], a.patient.birthDate);

      if (isReclassification) {
        await this.core.addEvent(tx, attendanceId, 'CLASSIFICACAO_ALTERADA', actor, { level: input.level, previousLevel: a.currentRiskLevel, reason: input.reason });
      }
      await this.audit.record(tx, actor, {
        action: isReclassification ? 'RISK_RECLASSIFIED' : 'RISK_CLASSIFIED',
        entityType: 'RiskClassification',
        attendanceId,
        attendanceCode: a.code,
        patientId: a.patientId,
        metadata: { protocol },
      });
      return { changed: true, status: a.status, code: a.code };
    });
    if (out.changed && out.status !== 'EM_TRIAGEM') {
      this.realtime.queueChanged('MEDICA');
      this.realtime.attendanceChanged(attendanceId, out.status);
    }
    return this.get(actor, attendanceId, { audit: false });
  }

  async finish(actor: Actor, attendanceId: string) {
    const out = await this.prisma.run(async (tx) => {
      const a = await tx.attendance.findUnique({
        where: { id: attendanceId },
        include: { accessibility: true, patient: { select: { birthDate: true } }, triage: true },
      });
      if (!a) throw notFound('Atendimento não encontrado.');
      if (a.status !== 'EM_TRIAGEM') throw conflict('Este atendimento não está em triagem.', ErrorCodes.INVALID_STATE);
      await this.assertHolder(tx, attendanceId, actor);
      if (!a.triage) throw conflict('A triagem ainda não foi iniciada.', ErrorCodes.INVALID_STATE);
      if (!a.currentRiskLevel) throw unprocessable('Classifique o risco antes de finalizar a triagem.', 'CLASSIFICATION_REQUIRED');

      const now = new Date();
      await tx.triage.updateMany({ where: { id: a.triage.id, status: 'IN_PROGRESS' }, data: { status: 'FINISHED', finishedById: actor.userId, finishedAt: now } });
      await this.core.transition(tx, a, 'AGUARDANDO_MEDICO', actor, { data: { triageFinishedAt: now } });
      await tx.queueEntry.updateMany({ where: { attendanceId, kind: 'TRIAGEM', status: 'IN_SERVICE' }, data: { status: 'DONE', finishedAt: now } });
      const score = await this.priority.medicalScore(a.currentRiskLevel, a.accessibility?.flags ?? [], a.patient.birthDate);
      await tx.queueEntry.upsert({
        where: { attendanceId_kind: { attendanceId, kind: 'MEDICA' } },
        create: { attendanceId, kind: 'MEDICA', status: 'WAITING', priorityScore: score, enqueuedAt: now },
        update: { status: 'WAITING', priorityScore: score, enqueuedAt: now },
      });
      await this.core.addEvent(tx, attendanceId, 'TRIAGEM_FINALIZADA', actor, { level: a.currentRiskLevel });
      const high = a.currentRiskLevel === 'EMERGENCIA' || a.currentRiskLevel === 'MUITO_URGENTE';
      await this.notifications.create(tx, {
        type: high ? 'FILA_MEDICA_PRIORIDADE_ALTA' : 'FILA_MEDICA',
        title: high ? 'Paciente de prioridade alta na fila médica' : 'Novo paciente na fila médica',
        message: `Atendimento ${a.code} aguardando atendimento médico.`,
        targetRole: 'MEDICO',
        attendanceCode: a.code,
      });
      await this.audit.record(tx, actor, { action: 'TRIAGE_FINISHED', entityType: 'Triage', entityId: a.triage.id, attendanceId, attendanceCode: a.code, patientId: a.patientId });
      return { code: a.code };
    });
    this.realtime.queueChanged('TRIAGEM');
    this.realtime.queueChanged('MEDICA');
    this.realtime.attendanceChanged(attendanceId, 'AGUARDANDO_MEDICO');
    this.realtime.notification('MEDICO');
    return { attendanceId, code: out.code, status: 'AGUARDANDO_MEDICO' };
  }

  /** Devolver à fila (ex.: paciente foi ao banheiro). Mantém a posição original e o rascunho da triagem. */
  async release(actor: Actor, attendanceId: string, reason: string) {
    await this.prisma.run(async (tx) => {
      const att = await this.core.getRef(tx, attendanceId);
      if (att.status !== 'EM_TRIAGEM') throw conflict('Este atendimento não está em triagem.', ErrorCodes.INVALID_STATE);
      await this.assertHolder(tx, attendanceId, actor);
      await tx.queueEntry.updateMany({
        where: { attendanceId, kind: 'TRIAGEM', status: 'IN_SERVICE', assignedUserId: actor.userId },
        data: { status: 'WAITING', assignedUserId: null, startedAt: null, version: { increment: 1 } },
      });
      await this.core.transition(tx, att, 'AGUARDANDO_TRIAGEM', actor, { reason });
      await this.core.addEvent(tx, attendanceId, 'TRIAGEM_DEVOLVIDA', actor, { reason });
      await this.audit.record(tx, actor, { action: 'TRIAGE_RELEASED', entityType: 'Attendance', entityId: attendanceId, attendanceId, attendanceCode: att.code, patientId: att.patientId });
    });
    this.realtime.queueChanged('TRIAGEM');
    this.realtime.attendanceChanged(attendanceId, 'AGUARDANDO_TRIAGEM');
    return { attendanceId, status: 'AGUARDANDO_TRIAGEM' };
  }
}
