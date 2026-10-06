import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../common/prisma/prisma.service';
import type { AuditActor } from '../auth/auth.types';

export interface AuditChanges {
  /** Nomes dos campos alterados. Para dados clínicos é só isto: o CONTEÚDO fica nas tabelas de versão, não no log. */
  fields: string[];
  /** Valores antes/depois — apenas para dados NÃO clínicos (usuários, parâmetros, cadastro com documentos mascarados). */
  diff?: Record<string, { from: unknown; to: unknown }>;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  attendanceId?: string | null;
  attendanceCode?: string | null;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}

const trunc = (s: string | null | undefined, n = 255): string | null => (s ? s.slice(0, n) : null);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma linha na trilha de auditoria. Passe a transação (`tx`) para que auditoria e mudança sejam atômicas:
   * se a mudança falhar, o registro de auditoria também não existe; se a auditoria falhar, a mudança é desfeita.
   */
  async record(db: Db, actor: AuditActor | null, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        username: actor?.username ?? null,
        sectorCode: actor?.sectorCode ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        patientId: entry.patientId ?? null,
        attendanceId: entry.attendanceId ?? null,
        attendanceCode: entry.attendanceCode ?? null,
        changes: entry.changes ? (entry.changes as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        metadata: entry.metadata ? (entry.metadata as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        ip: trunc(actor?.ip, 64),
        userAgent: trunc(actor?.userAgent),
        requestId: trunc(actor?.requestId, 64),
      },
    });
  }

  /** Melhor esforço, para eventos que não podem derrubar a requisição (ex.: tentativa negada). */
  async recordSafe(actor: AuditActor | null, entry: AuditEntry): Promise<void> {
    try {
      await this.record(this.prisma, actor, entry);
    } catch {
      /* o filtro/logger já registra falhas de banco; não mascarar o erro original da requisição */
    }
  }

  /**
   * Compara dois objetos e devolve os campos que mudaram.
   * `namesOnly`: devolve só os nomes (dados clínicos). `mask`: campos cujos valores são mascarados no diff.
   */
  diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    opts: { fields?: string[]; namesOnly?: boolean; mask?: Record<string, (v: unknown) => unknown> } = {},
  ): AuditChanges | null {
    const keys = opts.fields ?? Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changed: string[] = [];
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of keys) {
      const a = normalize(before[k]);
      const b = normalize(after[k]);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      changed.push(k);
      if (!opts.namesOnly) {
        const m = opts.mask?.[k];
        diff[k] = { from: m ? m(a) : a, to: m ? m(b) : b };
      }
    }
    if (changed.length === 0) return null;
    return opts.namesOnly ? { fields: changed } : { fields: changed, diff };
  }
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'toNumber' in (v as object)) return (v as { toNumber(): number }).toNumber();
  return v;
}
