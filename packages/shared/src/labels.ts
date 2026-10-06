import type {
  AccessibilityFlag,
  AccessibilityNeed,
  AttendanceStatus,
  DisabilityType,
  Outcome,
  RiskLevel,
  Sex,
  TimelineEventType,
} from './enums';
import { calcAge } from './datetime';
import { hasLegalPriority } from './queue-priority';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  AGUARDANDO_TRIAGEM: 'Aguardando triagem',
  EM_TRIAGEM: 'Em triagem',
  AGUARDANDO_MEDICO: 'Aguardando médico',
  EM_ATENDIMENTO: 'Em atendimento',
  MEDICACAO_REGISTRADA: 'Medicação/conduta registrada',
  ATENDIMENTO_FINALIZADO: 'Atendimento finalizado',
  CANCELADO: 'Cancelado',
};

/**
 * Cor + TEXTO + FORMA: nunca dependemos só da cor (daltonismo / baixa visão).
 * `shape` escolhe o ícone; `tone` são tokens de CSS definidos no frontend (contraste AA verificado lá).
 */
export const RISK_META: Record<RiskLevel, { label: string; short: string; color: string; shape: 'octagon' | 'triangle' | 'diamond' | 'square' | 'circle'; description: string }> = {
  EMERGENCIA: { label: 'Emergência', short: 'EMERG.', color: 'red', shape: 'octagon', description: 'Atendimento imediato' },
  MUITO_URGENTE: { label: 'Muito urgente', short: 'M. URG.', color: 'orange', shape: 'triangle', description: 'Atendimento muito rápido' },
  URGENTE: { label: 'Urgente', short: 'URG.', color: 'yellow', shape: 'diamond', description: 'Atendimento rápido' },
  POUCO_URGENTE: { label: 'Pouco urgente', short: 'P. URG.', color: 'green', shape: 'square', description: 'Pode aguardar' },
  NAO_URGENTE: { label: 'Não urgente', short: 'N. URG.', color: 'blue', shape: 'circle', description: 'Atendimento não urgente' },
};

export const SEX_LABELS: Record<Sex, string> = {
  MASCULINO: 'Masculino',
  FEMININO: 'Feminino',
  INTERSEXO: 'Intersexo',
  NAO_INFORMADO: 'Não informado',
};

export const DISABILITY_LABELS: Record<DisabilityType, string> = {
  FISICA: 'Física',
  AUDITIVA: 'Auditiva',
  VISUAL: 'Visual',
  INTELECTUAL: 'Intelectual',
  PSICOSSOCIAL: 'Psicossocial',
  MULTIPLA: 'Múltipla',
  NAO_INFORMADO: 'Não informado',
};

export const ACCESSIBILITY_FLAG_META: Record<AccessibilityFlag, { label: string; short: string; icon: string }> = {
  PCD: { label: 'Pessoa com deficiência (PCD)', short: 'PCD', icon: 'accessibility' },
  IDOSO: { label: 'Pessoa idosa', short: 'Idoso(a)', icon: 'elderly' },
  GESTANTE: { label: 'Gestante', short: 'Gestante', icon: 'pregnant' },
  CRIANCA: { label: 'Criança', short: 'Criança', icon: 'child' },
  MOBILIDADE_REDUZIDA: { label: 'Pessoa com mobilidade reduzida', short: 'Mobilidade reduzida', icon: 'cane' },
  NECESSITA_ACOMPANHANTE: { label: 'Necessita acompanhante', short: 'Acompanhante', icon: 'users' },
  NECESSITA_INTERPRETE: { label: 'Necessita intérprete', short: 'Intérprete', icon: 'languages' },
  NECESSITA_LIBRAS: { label: 'Necessita Libras', short: 'Libras', icon: 'hand' },
  NECESSITA_AUXILIO_VISUAL: { label: 'Necessita auxílio visual', short: 'Auxílio visual', icon: 'eye' },
  NECESSITA_AUXILIO_COMUNICACAO: { label: 'Necessita auxílio de comunicação', short: 'Aux. comunicação', icon: 'message' },
  OUTRA: { label: 'Outra necessidade', short: 'Outra necessidade', icon: 'info' },
};

export const ACCESSIBILITY_NEED_LABELS: Record<AccessibilityNeed, string> = {
  CADEIRA_DE_RODAS: 'Cadeira de rodas',
  MULETAS: 'Muletas',
  ANDADOR: 'Andador',
  BENGALA: 'Bengala',
  AUXILIO_LOCOMOCAO: 'Auxílio para locomoção',
  INTERPRETE_LIBRAS: 'Intérprete de Libras',
  AUXILIO_COMUNICACAO: 'Auxílio de comunicação',
  ACOMPANHANTE: 'Acompanhante',
  AUXILIO_VISUAL: 'Auxílio visual',
  OUTRA: 'Outra',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  MEDICADO: 'Medicado',
  ALTA: 'Alta',
  RETORNO: 'Retorno',
  ENCAMINHAMENTO: 'Encaminhamento',
  OUTRO: 'Outro',
};

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  ENTRADA: 'Entrada',
  TRIAGEM_INICIADA: 'Triagem iniciada',
  TRIAGEM_DEVOLVIDA: 'Triagem devolvida à fila',
  TRIAGEM_FINALIZADA: 'Triagem finalizada',
  CLASSIFICACAO_ALTERADA: 'Classificação de risco alterada',
  ACESSIBILIDADE_ATUALIZADA: 'Informações de acessibilidade atualizadas',
  CHAMADO: 'Paciente chamado',
  RECHAMADO: 'Paciente chamado novamente',
  DEVOLVIDO_A_FILA: 'Paciente devolvido à fila médica',
  ATENDIMENTO_INICIADO: 'Atendimento médico iniciado',
  DIAGNOSTICO_REGISTRADO: 'Diagnóstico registrado',
  MEDICACAO_REGISTRADA: 'Medicação/conduta registrada',
  REGISTRO_CORRIGIDO: 'Registro clínico corrigido',
  COMPLEMENTO_REGISTRADO: 'Complemento registrado',
  ATENDIMENTO_FINALIZADO: 'Atendimento finalizado',
  ATENDIMENTO_CANCELADO: 'Atendimento cancelado',
};

/** Ordem de exibição das flags nos selos (mais relevantes para a locomoção/comunicação primeiro). */
export const ACCESSIBILITY_FLAG_ORDER: readonly AccessibilityFlag[] = [
  'PCD',
  'MOBILIDADE_REDUZIDA',
  'IDOSO',
  'GESTANTE',
  'CRIANCA',
  'NECESSITA_LIBRAS',
  'NECESSITA_INTERPRETE',
  'NECESSITA_AUXILIO_VISUAL',
  'NECESSITA_AUXILIO_COMUNICACAO',
  'NECESSITA_ACOMPANHANTE',
  'OUTRA',
];

export const ELDERLY_MIN_AGE = 60;
export const CHILD_MAX_AGE_EXCLUSIVE = 12;

/** Flags efetivas: as registradas + as derivadas da idade (idoso ≥ 60, criança < 12). */
export function effectiveAccessibilityFlags(
  flags: readonly AccessibilityFlag[],
  birthDate: string | null | undefined,
  ref: Date = new Date(),
): AccessibilityFlag[] {
  const set = new Set<AccessibilityFlag>(flags);
  if (birthDate) {
    const { years } = calcAge(birthDate, ref);
    if (years >= ELDERLY_MIN_AGE) set.add('IDOSO');
    if (years < CHILD_MAX_AGE_EXCLUSIVE) set.add('CRIANCA');
  }
  return ACCESSIBILITY_FLAG_ORDER.filter((f) => set.has(f));
}

export function patientHasLegalPriority(flags: readonly AccessibilityFlag[], birthDate: string | null | undefined, ref?: Date): boolean {
  return hasLegalPriority(effectiveAccessibilityFlags(flags, birthDate, ref));
}
