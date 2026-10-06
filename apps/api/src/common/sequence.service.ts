import { Inject, Injectable } from '@nestjs/common';
import { localDateString, localYear } from '@hospital/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { Tx } from './prisma/prisma.service';

/**
 * Contadores atômicos. `INSERT … ON CONFLICT DO UPDATE … RETURNING` trava a linha do contador até o COMMIT,
 * então duas recepções criando atendimentos no mesmo instante recebem números distintos e SEM buracos
 * (se a transação falhar, o incremento é desfeito junto).
 */
@Injectable()
export class SequenceService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async next(tx: Tx, key: string): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "sequence_counters" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "sequence_counters"."value" + 1
      RETURNING "value"`;
    return rows[0].value;
  }

  /** ATD-AAAA-NNNNNN (ano no fuso do hospital) e a senha do dia. Ordem de aquisição fixa (evita deadlock). */
  async nextAttendanceNumbers(tx: Tx, now: Date = new Date()): Promise<{ year: number; sequence: number; code: string; ticketDate: string; ticketNumber: number }> {
    const year = localYear(now, this.config.timezone);
    const ticketDate = localDateString(now, this.config.timezone);
    const sequence = await this.next(tx, `attendance:${year}`);
    const ticketNumber = await this.next(tx, `ticket:${ticketDate}`);
    return { year, sequence, code: `ATD-${year}-${String(sequence).padStart(6, '0')}`, ticketDate, ticketNumber };
  }
}

export const formatTicket = (n: number): string => String(n).padStart(3, '0');
