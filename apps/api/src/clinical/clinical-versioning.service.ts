import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClinicalRecordType } from '@hospital/shared';
import type { Tx } from '../common/prisma/prisma.service';
import type { Actor } from '../auth/auth.types';

/**
 * VERSÃO ANTERIOR → CORREÇÃO → NOVO REGISTRO.
 * Antes de qualquer alteração de conteúdo clínico, o estado anterior é arquivado (append-only).
 * O banco recusa (trigger) uma alteração de conteúdo sem este arquivamento e sem version+1.
 */
@Injectable()
export class ClinicalVersioningService {
  async archive(
    tx: Tx,
    args: { attendanceId: string; recordType: ClinicalRecordType; recordId: string; version: number; snapshot: Record<string, unknown>; actor: Actor; reason?: string | null },
  ): Promise<void> {
    await tx.clinicalRecordVersion.create({
      data: {
        attendanceId: args.attendanceId,
        recordType: args.recordType,
        recordId: args.recordId,
        version: args.version,
        snapshot: args.snapshot as Prisma.InputJsonValue,
        changedById: args.actor.userId,
        changeReason: args.reason ?? null,
      },
    });
  }

  /** Lista de versões (sem conteúdo) para exibir "quem alterou, quando e por quê". */
  async list(db: Tx | Prisma.TransactionClient, attendanceId: string) {
    const rows = await db.clinicalRecordVersion.findMany({
      where: { attendanceId },
      include: { changedBy: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      recordType: r.recordType,
      version: r.version,
      changedBy: r.changedBy.fullName,
      changeReason: r.changeReason,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

/** Compara campos de texto clínico; devolve os nomes alterados. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: (keyof T)[]): string[] {
  return fields.filter((f) => (before[f] ?? null) !== (after[f] ?? null)).map(String);
}
