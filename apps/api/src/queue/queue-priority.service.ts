import { Injectable } from '@nestjs/common';
import { AccessibilityFlag, RiskLevel, medicalPriorityScore, patientHasLegalPriority } from '@hospital/shared';
import type { Tx } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dateOnly } from '../attendances/attendance.mapper';

/**
 * Posição na fila médica = nível de risco (definido por profissional) + desempate legal opcional.
 * A acessibilidade NUNCA altera o nível de risco; no máximo desempata dentro do mesmo nível, se o hospital habilitar.
 */
@Injectable()
export class QueuePriorityService {
  constructor(private readonly settings: SettingsService) {}

  async medicalScore(level: RiskLevel, flags: AccessibilityFlag[], birthDate: Date): Promise<number> {
    const tiebreak = await this.settings.get('queue.legal_priority_tiebreak');
    return medicalPriorityScore(level, patientHasLegalPriority(flags, dateOnly(birthDate)), tiebreak);
  }

  /** Atualiza a pontuação apenas de quem ainda está AGUARDANDO (quem já foi chamado não muda de lugar). */
  async refresh(tx: Tx, attendanceId: string, level: RiskLevel, flags: AccessibilityFlag[], birthDate: Date): Promise<void> {
    const score = await this.medicalScore(level, flags, birthDate);
    await tx.queueEntry.updateMany({ where: { attendanceId, kind: 'MEDICA', status: 'WAITING' }, data: { priorityScore: score } });
  }
}
