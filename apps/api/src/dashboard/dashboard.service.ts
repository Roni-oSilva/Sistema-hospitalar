import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RISK_LEVELS, dayRange, localDateString } from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { badRequest } from '../common/errors/app-error';

const avg = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private range(date?: string) {
    const d = date ?? localDateString(new Date(), this.config.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('Data inválida.');
    return { date: d, ...dayRange(d, this.config.timezone) };
  }

  /**
   * Contadores. Os de "agora" (aguardando, em triagem…) olham o estado ATUAL, sem filtro de dia — quem chegou às 23h50
   * e ainda espera à 0h10 continua contando. Os de "hoje" usam o dia local do hospital.
   */
  async summary(date?: string) {
    const { date: d, start, end } = this.range(date);
    const [byStatus, today, finishedToday, cancelledToday] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { status: { in: ['AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_MEDICO', 'EM_ATENDIMENTO', 'MEDICACAO_REGISTRADA'] } },
        _count: { _all: true },
      }),
      this.prisma.attendance.count({ where: { arrivedAt: { gte: start, lt: end } } }),
      this.prisma.attendance.count({ where: { finishedAt: { gte: start, lt: end } } }),
      this.prisma.attendance.count({ where: { cancelledAt: { gte: start, lt: end } } }),
    ]);
    const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      date: d,
      attendancesToday: today,
      waitingTriage: n('AGUARDANDO_TRIAGEM'),
      inTriage: n('EM_TRIAGEM'),
      waitingDoctor: n('AGUARDANDO_MEDICO'),
      inConsultation: n('EM_ATENDIMENTO') + n('MEDICACAO_REGISTRADA'),
      finishedToday,
      cancelledToday,
    };
  }

  /** Indicadores agregados do dia (sem nenhum dado individual). */
  async indicators(date?: string) {
    const { date: d, start, end } = this.range(date);
    const tz = this.config.timezone;
    const [times] = await this.prisma.$queryRaw<{ to_triage: unknown; medical_wait: unknown; total: unknown }[]>`
      SELECT
        avg(extract(epoch FROM ("triage_started_at" - "arrived_at")) / 60) FILTER (WHERE "triage_started_at" IS NOT NULL) AS to_triage,
        avg(extract(epoch FROM ("first_called_at" - "triage_finished_at")) / 60) FILTER (WHERE "first_called_at" IS NOT NULL AND "triage_finished_at" IS NOT NULL) AS medical_wait,
        avg(extract(epoch FROM ("finished_at" - "arrived_at")) / 60) FILTER (WHERE "finished_at" IS NOT NULL) AS total
      FROM "attendances"
      WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}`;
    const perHour = await this.prisma.$queryRaw<{ hour: number; count: bigint }[]>`
      SELECT date_part('hour', "arrived_at" AT TIME ZONE ${tz})::int AS hour, count(*) AS count
      FROM "attendances" WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}
      GROUP BY 1 ORDER BY 1`;
    const byRisk = await this.prisma.attendance.groupBy({ by: ['currentRiskLevel'], where: { arrivedAt: { gte: start, lt: end } }, _count: { _all: true } });
    const byOutcome = await this.prisma.medicalConsultation.groupBy({ by: ['outcome'], where: { finishedAt: { gte: start, lt: end } }, _count: { _all: true } });
    const summary = await this.summary(d);

    return {
      date: d,
      summary,
      averageMinutes: { toTriage: avg(times?.to_triage), medicalWait: avg(times?.medical_wait), total: avg(times?.total) },
      perHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: Number(perHour.find((p) => p.hour === h)?.count ?? 0) })),
      byRisk: [
        ...RISK_LEVELS.map((level) => ({ level, count: byRisk.find((b) => b.currentRiskLevel === level)?._count._all ?? 0 })),
        { level: null, count: byRisk.find((b) => b.currentRiskLevel === null)?._count._all ?? 0 },
      ],
      byOutcome: byOutcome.map((b) => ({ outcome: b.outcome, count: b._count._all })),
      waitingNow: summary.waitingTriage + summary.waitingDoctor,
    };
  }
}

export type { Prisma };
