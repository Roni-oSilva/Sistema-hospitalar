import type { AccessibilityFlag, RiskLevel } from './enums';

/** 1 = mais grave. A classificação é SEMPRE humana; isto só ordena a fila a partir do que o profissional definiu. */
export const RISK_RANK: Record<RiskLevel, number> = {
  EMERGENCIA: 1,
  MUITO_URGENTE: 2,
  URGENTE: 3,
  POUCO_URGENTE: 4,
  NAO_URGENTE: 5,
};

/**
 * Pontuação de ordenação da fila (menor = chamado antes). Armazenada em queue.priority_score para que a escolha
 * do "próximo" seja feita em SQL, de forma atômica (ORDER BY priority_score, enqueued_at).
 *
 * - Fila de triagem: sempre 0 → FIFO por horário de chegada.
 * - Fila médica: nível de risco × 10. Se o hospital habilitar o desempate legal (Lei 10.048/2000: PCD, idosos,
 *   gestantes, mobilidade reduzida), dentro do MESMO nível quem tem prioridade legal passa à frente (+0 vs +1).
 *   Isso nunca muda a classificação clínica nem leva alguém a um nível mais grave.
 */
export function medicalPriorityScore(level: RiskLevel, hasLegalPriority: boolean, legalTieBreak: boolean): number {
  const base = RISK_RANK[level] * 10;
  if (!legalTieBreak) return base;
  return base + (hasLegalPriority ? 0 : 1);
}

export const LEGAL_PRIORITY_FLAGS: readonly AccessibilityFlag[] = ['PCD', 'IDOSO', 'GESTANTE', 'MOBILIDADE_REDUZIDA'];

export function hasLegalPriority(flags: readonly AccessibilityFlag[]): boolean {
  return flags.some((f) => LEGAL_PRIORITY_FLAGS.includes(f));
}

export const DEFAULT_MAX_WAIT_MINUTES: Record<RiskLevel, number> = {
  EMERGENCIA: 0,
  MUITO_URGENTE: 10,
  URGENTE: 60,
  POUCO_URGENTE: 120,
  NAO_URGENTE: 240,
};
