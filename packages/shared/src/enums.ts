/**
 * Enumerações de domínio. Espelham os enums do Prisma (apps/api/prisma/schema.prisma);
 * o teste `enums-sync` na API garante que não divergem.
 */

export const ATTENDANCE_STATUSES = [
  'AGUARDANDO_TRIAGEM',
  'EM_TRIAGEM',
  'AGUARDANDO_MEDICO',
  'EM_ATENDIMENTO',
  'MEDICACAO_REGISTRADA',
  'ATENDIMENTO_FINALIZADO',
  'CANCELADO',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_KINDS = ['ATENDIMENTO', 'RETORNO'] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

/** Classificação de risco, da mais grave (1) à menos grave (5). */
export const RISK_LEVELS = ['EMERGENCIA', 'MUITO_URGENTE', 'URGENTE', 'POUCO_URGENTE', 'NAO_URGENTE'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const QUEUE_KINDS = ['TRIAGEM', 'MEDICA'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_STATUSES = ['WAITING', 'CALLED', 'IN_SERVICE', 'DONE', 'CANCELLED'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const SEXES = ['MASCULINO', 'FEMININO', 'INTERSEXO', 'NAO_INFORMADO'] as const;
export type Sex = (typeof SEXES)[number];

export const PHONE_TYPES = ['TELEFONE', 'CELULAR'] as const;
export type PhoneType = (typeof PHONE_TYPES)[number];

export const DISABILITY_TYPES = [
  'FISICA',
  'AUDITIVA',
  'VISUAL',
  'INTELECTUAL',
  'PSICOSSOCIAL',
  'MULTIPLA',
  'NAO_INFORMADO',
] as const;
export type DisabilityType = (typeof DISABILITY_TYPES)[number];

export const ACCESSIBILITY_FLAGS = [
  'PCD',
  'IDOSO',
  'GESTANTE',
  'CRIANCA',
  'MOBILIDADE_REDUZIDA',
  'NECESSITA_ACOMPANHANTE',
  'NECESSITA_INTERPRETE',
  'NECESSITA_LIBRAS',
  'NECESSITA_AUXILIO_VISUAL',
  'NECESSITA_AUXILIO_COMUNICACAO',
  'OUTRA',
] as const;
export type AccessibilityFlag = (typeof ACCESSIBILITY_FLAGS)[number];

export const ACCESSIBILITY_NEEDS = [
  'CADEIRA_DE_RODAS',
  'MULETAS',
  'ANDADOR',
  'BENGALA',
  'AUXILIO_LOCOMOCAO',
  'INTERPRETE_LIBRAS',
  'AUXILIO_COMUNICACAO',
  'ACOMPANHANTE',
  'AUXILIO_VISUAL',
  'OUTRA',
] as const;
export type AccessibilityNeed = (typeof ACCESSIBILITY_NEEDS)[number];

export const OUTCOMES = ['MEDICADO', 'ALTA', 'RETORNO', 'ENCAMINHAMENTO', 'OUTRO'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CONSULTATION_STATUSES = ['IN_PROGRESS', 'FINISHED'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export const MEDICAL_NOTE_TYPES = ['COMPLEMENTO', 'CORRECAO'] as const;
export type MedicalNoteType = (typeof MEDICAL_NOTE_TYPES)[number];

/** Tipos de evento da linha do tempo. */
export const TIMELINE_EVENT_TYPES = [
  'ENTRADA',
  'TRIAGEM_INICIADA',
  'TRIAGEM_DEVOLVIDA',
  'TRIAGEM_FINALIZADA',
  'CLASSIFICACAO_ALTERADA',
  'ACESSIBILIDADE_ATUALIZADA',
  'CHAMADO',
  'RECHAMADO',
  'DEVOLVIDO_A_FILA',
  'ATENDIMENTO_INICIADO',
  'DIAGNOSTICO_REGISTRADO',
  'MEDICACAO_REGISTRADA',
  'REGISTRO_CORRIGIDO',
  'COMPLEMENTO_REGISTRADO',
  'ATENDIMENTO_FINALIZADO',
  'ATENDIMENTO_CANCELADO',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** GENERAL: visível a qualquer perfil com acesso ao atendimento. CLINICAL: detalhes só para quem tem permissão clínica. */
export const TIMELINE_CATEGORIES = ['GENERAL', 'CLINICAL'] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export const CLINICAL_RECORD_TYPES = ['TRIAGEM', 'CONSULTA'] as const;
export type ClinicalRecordType = (typeof CLINICAL_RECORD_TYPES)[number];

export const ACCESS_EVENTS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_BLOCKED',
  'LOGOUT',
  'SESSION_EXPIRED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
] as const;
export type AccessEvent = (typeof ACCESS_EVENTS)[number];

export const SECTOR_CODES = ['RECEPCAO', 'TRIAGEM', 'CONSULTORIOS', 'ADMINISTRACAO'] as const;
export type SectorCode = (typeof SECTOR_CODES)[number];

export const ROLE_CODES = ['ADMINISTRADOR', 'RECEPCAO', 'TRIAGEM', 'MEDICO'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
