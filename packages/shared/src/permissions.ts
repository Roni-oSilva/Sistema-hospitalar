import type { RoleCode } from './enums';

/**
 * Catálogo de permissões (RBAC, menor privilégio).
 * Formato `modulo:acao`. A API valida SEMPRE no servidor; o frontend só usa isto para esconder o que não cabe ao perfil.
 */
export const PERMISSIONS = {
  // administração
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  ROLES_READ: 'roles:read',
  ROLES_WRITE: 'roles:write',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  FACILITIES_READ: 'facilities:read',
  FACILITIES_WRITE: 'facilities:write',
  AUDIT_READ: 'audit:read',
  INDICATORS_READ: 'indicators:read',
  REPORTS_READ: 'reports:read',

  // recepção / cadastro
  PATIENTS_SEARCH: 'patients:search',
  PATIENTS_READ: 'patients:read',
  PATIENTS_WRITE: 'patients:write',
  PATIENTS_VIEW_DOCUMENTS: 'patients:view-documents',
  ACCESSIBILITY_WRITE: 'accessibility:write',
  ATTENDANCES_CREATE: 'attendances:create',
  ATTENDANCES_READ: 'attendances:read',
  ATTENDANCES_CANCEL: 'attendances:cancel',

  // triagem
  TRIAGE_QUEUE: 'triage:queue',
  TRIAGE_PERFORM: 'triage:perform',
  TRIAGE_CLASSIFY: 'triage:classify',
  TRIAGE_READ: 'triage:read',

  // médico
  MEDICAL_QUEUE: 'medical:queue',
  MEDICAL_CALL: 'medical:call',
  MEDICAL_ATTEND: 'medical:attend',
  MEDICAL_CORRECT: 'medical:correct',
  CONSULTATION_READ: 'consultation:read',
  CLINICAL_HISTORY_READ: 'clinical-history:read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, { module: string; description: string }> = {
  'users:read': { module: 'Administração', description: 'Visualizar usuários' },
  'users:write': { module: 'Administração', description: 'Criar, editar, ativar/desativar usuários e redefinir senhas' },
  'roles:read': { module: 'Administração', description: 'Visualizar perfis e permissões' },
  'roles:write': { module: 'Administração', description: 'Alterar as permissões dos perfis' },
  'settings:read': { module: 'Administração', description: 'Visualizar parâmetros do sistema' },
  'settings:write': { module: 'Administração', description: 'Alterar parâmetros do sistema' },
  'facilities:read': { module: 'Administração', description: 'Visualizar setores e consultórios' },
  'facilities:write': { module: 'Administração', description: 'Configurar setores e consultórios' },
  'audit:read': { module: 'Administração', description: 'Consultar auditoria e logs de acesso' },
  'indicators:read': { module: 'Administração', description: 'Ver indicadores agregados' },
  'reports:read': { module: 'Administração', description: 'Ver relatórios agregados (sem dados individuais)' },

  'patients:search': { module: 'Recepção', description: 'Pesquisar pacientes' },
  'patients:read': { module: 'Recepção', description: 'Ver dados cadastrais do paciente' },
  'patients:write': { module: 'Recepção', description: 'Cadastrar e atualizar pacientes' },
  'patients:view-documents': { module: 'Recepção', description: 'Ver CPF/CNS/RG completos (sem máscara)' },
  'accessibility:write': { module: 'Recepção', description: 'Registrar necessidades de acessibilidade' },
  'attendances:create': { module: 'Recepção', description: 'Criar atendimento' },
  'attendances:read': { module: 'Recepção', description: 'Ver atendimentos, status e linha do tempo geral' },
  'attendances:cancel': { module: 'Recepção', description: 'Cancelar atendimento que ainda não iniciou a triagem' },

  'triage:queue': { module: 'Triagem', description: 'Ver a fila de triagem' },
  'triage:perform': { module: 'Triagem', description: 'Realizar triagem (queixa, sinais vitais, finalizar)' },
  'triage:classify': { module: 'Triagem', description: 'Classificar/reclassificar o risco' },
  'triage:read': { module: 'Triagem', description: 'Ver dados clínicos da triagem' },

  'medical:queue': { module: 'Médico', description: 'Ver a fila médica' },
  'medical:call': { module: 'Médico', description: 'Chamar paciente' },
  'medical:attend': { module: 'Médico', description: 'Realizar atendimento, prescrever e finalizar' },
  'medical:correct': { module: 'Médico', description: 'Corrigir registros após a finalização (com justificativa)' },
  'consultation:read': { module: 'Médico', description: 'Ver dados clínicos do atendimento médico' },
  'clinical-history:read': { module: 'Médico', description: 'Ver histórico de atendimentos anteriores do paciente' },
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

const P = PERMISSIONS;

/**
 * Permissões padrão de cada perfil (usadas no seed e nos testes).
 * Observação de privacidade: o ADMINISTRADOR NÃO recebe permissões clínicas por padrão.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  ADMINISTRADOR: [
    P.USERS_READ, P.USERS_WRITE, P.ROLES_READ, P.ROLES_WRITE, P.SETTINGS_READ, P.SETTINGS_WRITE,
    P.FACILITIES_READ, P.FACILITIES_WRITE, P.AUDIT_READ, P.INDICATORS_READ, P.REPORTS_READ, P.ATTENDANCES_READ,
  ],
  RECEPCAO: [
    P.PATIENTS_SEARCH, P.PATIENTS_READ, P.PATIENTS_WRITE, P.PATIENTS_VIEW_DOCUMENTS, P.ACCESSIBILITY_WRITE,
    P.ATTENDANCES_CREATE, P.ATTENDANCES_READ, P.ATTENDANCES_CANCEL, P.FACILITIES_READ,
  ],
  TRIAGEM: [
    P.PATIENTS_READ, P.ACCESSIBILITY_WRITE, P.ATTENDANCES_READ, P.TRIAGE_QUEUE, P.TRIAGE_PERFORM, P.TRIAGE_CLASSIFY,
    P.TRIAGE_READ,
  ],
  MEDICO: [
    P.PATIENTS_READ, P.ATTENDANCES_READ, P.TRIAGE_READ, P.TRIAGE_CLASSIFY, P.MEDICAL_QUEUE, P.MEDICAL_CALL,
    P.MEDICAL_ATTEND, P.MEDICAL_CORRECT, P.CONSULTATION_READ, P.CLINICAL_HISTORY_READ, P.FACILITIES_READ,
  ],
};

export const ROLE_DESCRIPTIONS: Record<RoleCode, { name: string; description: string; home: string }> = {
  ADMINISTRADOR: { name: 'Administrador', description: 'Gestão do sistema, usuários, indicadores e auditoria', home: '/dashboard' },
  RECEPCAO: { name: 'Recepção', description: 'Cadastro de pacientes e abertura de atendimentos', home: '/recepcao' },
  TRIAGEM: { name: 'Triagem', description: 'Sinais vitais e classificação de risco', home: '/triagem' },
  MEDICO: { name: 'Médico', description: 'Atendimento médico, medicação e conduta', home: '/medico' },
};
