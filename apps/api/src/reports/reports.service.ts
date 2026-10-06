import { Inject, Injectable } from '@nestjs/common';
import { ACCESSIBILITY_FLAGS, dayRange } from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest } from '../common/errors/app-error';

const num = (v: unknown): number => Number(v ?? 0);
const avg = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

/**
 * Relatórios AGREGADOS por período. Nenhuma linha identifica paciente; grupos com menos de 3 casos de
 * acessibilidade são exibidos como "<3" para reduzir risco de reidentificação.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async overview(actor: Actor, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw badRequest('Período inválido.');
    const start = dayRange(from, this.config.timezone).start;
    const end = dayRange(to, this.config.timezone).end;
    if (end.getTime() - start.getTime() > 366 * 86_400_000) throw badRequest('O período máximo é de 1 ano.');
    const tz = this.config.timezone;

    const perDay = await this.prisma.$queryRaw<{ day: Date; total: bigint; finished: bigint; cancelled: bigint }[]>`
      SELECT ("arrived_at" AT TIME ZONE ${tz})::date AS day, count(*) AS total,
             count(*) FILTER (WHERE "status" = 'ATENDIMENTO_FINALIZADO') AS finished,
             count(*) FILTER (WHERE "status" = 'CANCELADO') AS cancelled
      FROM "attendances" WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}
      GROUP BY 1 ORDER BY 1`;
    const byRisk = await this.prisma.$queryRaw<{ level: string | null; total: bigint; avg_wait: unknown }[]>`
      SELECT "current_risk_level"::text AS level, count(*) AS total,
             avg(extract(epoch FROM ("first_called_at" - "triage_finished_at")) / 60) AS avg_wait
      FROM "attendances" WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}
      GROUP BY 1 ORDER BY 1`;
    const [times] = await this.prisma.$queryRaw<{ to_triage: unknown; medical_wait: unknown; total: unknown }[]>`
      SELECT avg(extract(epoch FROM ("triage_started_at" - "arrived_at")) / 60) AS to_triage,
             avg(extract(epoch FROM ("first_called_at" - "triage_finished_at")) / 60) AS medical_wait,
             avg(extract(epoch FROM ("finished_at" - "arrived_at")) / 60) AS total
      FROM "attendances" WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}`;
    const ageBands = await this.prisma.$queryRaw<{ band: string; total: bigint }[]>`
      SELECT CASE
               WHEN age < 12 THEN '0–11' WHEN age < 18 THEN '12–17' WHEN age < 40 THEN '18–39'
               WHEN age < 60 THEN '40–59' WHEN age < 80 THEN '60–79' ELSE '80+' END AS band,
             count(*) AS total
      FROM (SELECT date_part('year', age(("a"."arrived_at" AT TIME ZONE ${tz})::date, "p"."birth_date")) AS age
              FROM "attendances" "a" JOIN "patients" "p" ON "p"."id" = "a"."patient_id"
             WHERE "a"."arrived_at" >= ${start} AND "a"."arrived_at" < ${end}) t
      GROUP BY 1 ORDER BY 1`;
    const accessibility = await this.prisma.$queryRaw<{ flag: string; total: bigint }[]>`
      SELECT unnest("aa"."flags")::text AS flag, count(*) AS total
      FROM "attendance_accessibility" "aa" JOIN "attendances" "a" ON "a"."id" = "aa"."attendance_id"
      WHERE "a"."arrived_at" >= ${start} AND "a"."arrived_at" < ${end}
      GROUP BY 1`;
    const doctors = await this.prisma.$queryRaw<{ name: string; finished: bigint; avg_minutes: unknown }[]>`
      SELECT "u"."full_name" AS name, count(*) AS finished,
             avg(extract(epoch FROM ("c"."finished_at" - "c"."started_at")) / 60) AS avg_minutes
      FROM "medical_consultations" "c" JOIN "users" "u" ON "u"."id" = "c"."doctor_id"
      WHERE "c"."finished_at" >= ${start} AND "c"."finished_at" < ${end}
      GROUP BY 1 ORDER BY 2 DESC`;
    const triagers = await this.prisma.$queryRaw<{ name: string; finished: bigint }[]>`
      SELECT "u"."full_name" AS name, count(*) AS finished
      FROM "triage" "t" JOIN "users" "u" ON "u"."id" = "t"."finished_by_id"
      WHERE "t"."finished_at" >= ${start} AND "t"."finished_at" < ${end}
      GROUP BY 1 ORDER BY 2 DESC`;
    const bySector = await this.prisma.$queryRaw<{ sector: string | null; total: bigint }[]>`
      SELECT "sector_code" AS sector, count(*) AS total FROM "attendance_events" "e"
      JOIN "attendances" "a" ON "a"."id" = "e"."attendance_id"
      WHERE "a"."arrived_at" >= ${start} AND "a"."arrived_at" < ${end}
      GROUP BY 1 ORDER BY 2 DESC`;
    const patients = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(DISTINCT "patient_id") AS total FROM "attendances" WHERE "arrived_at" >= ${start} AND "arrived_at" < ${end}`;

    await this.audit.record(this.prisma, actor, { action: 'REPORT_VIEWED', entityType: 'Report', metadata: { report: 'overview', from, to } });

    const small = (n: number): number | string => (n > 0 && n < 3 ? '<3' : n);
    return {
      period: { from, to },
      totals: {
        attendances: perDay.reduce((s, r) => s + num(r.total), 0),
        finished: perDay.reduce((s, r) => s + num(r.finished), 0),
        cancelled: perDay.reduce((s, r) => s + num(r.cancelled), 0),
        distinctPatients: num(patients[0]?.total),
      },
      averageMinutes: { toTriage: avg(times?.to_triage), medicalWait: avg(times?.medical_wait), total: avg(times?.total) },
      perDay: perDay.map((r) => ({ day: r.day.toISOString().slice(0, 10), total: num(r.total), finished: num(r.finished), cancelled: num(r.cancelled) })),
      byRisk: byRisk.map((r) => ({ level: r.level, total: num(r.total), avgMedicalWaitMinutes: avg(r.avg_wait) })),
      ageBands: ageBands.map((r) => ({ band: r.band, total: num(r.total) })),
      accessibility: ACCESSIBILITY_FLAGS.map((f) => ({ flag: f, total: small(num(accessibility.find((a) => a.flag === f)?.total)) })),
      productivity: {
        doctors: doctors.map((d) => ({ name: d.name, finished: num(d.finished), avgMinutes: avg(d.avg_minutes) })),
        triage: triagers.map((t) => ({ name: t.name, finished: num(t.finished) })),
      },
      eventsBySector: bySector.map((s) => ({ sector: s.sector ?? 'SISTEMA', total: num(s.total) })),
    };
  }
}
