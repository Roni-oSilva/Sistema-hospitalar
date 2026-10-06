import { z } from 'zod';
import { RISK_LEVELS } from './enums';
import { DEFAULT_MAX_WAIT_MINUTES } from './queue-priority';

/**
 * Parâmetros configuráveis pelo administrador. Cada chave tem schema (validação) e valor padrão.
 * Segredos NUNCA entram aqui — ficam em variáveis de ambiente.
 */
const maxWaitSchema = z.object(
  Object.fromEntries(RISK_LEVELS.map((l) => [l, z.number().int().min(0).max(1440)])) as Record<(typeof RISK_LEVELS)[number], z.ZodNumber>,
);

export const SETTINGS_DEFINITIONS = {
  'hospital.name': {
    schema: z.string().trim().min(3).max(120),
    default: 'Hospital Municipal de Ulianópolis',
    description: 'Nome do hospital exibido nas telas',
  },
  'triage.protocol_name': {
    schema: z.string().trim().min(2).max(80),
    default: 'Protocolo do hospital (5 níveis)',
    description: 'Protocolo de classificação de risco adotado (registrado em cada classificação)',
  },
  'triage.max_wait_minutes': {
    schema: maxWaitSchema,
    default: DEFAULT_MAX_WAIT_MINUTES,
    description: 'Tempo máximo de espera recomendado por nível (minutos) — apenas sinalização visual na fila',
  },
  'queue.legal_priority_tiebreak': {
    schema: z.boolean(),
    default: false,
    description: 'Desempate dentro do mesmo nível de risco por prioridade legal (PCD, idoso, gestante, mobilidade reduzida)',
  },
  'session.idle_minutes': {
    schema: z.number().int().min(5).max(240),
    default: 30,
    description: 'Minutos de inatividade até a sessão expirar',
  },
  'session.absolute_hours': {
    schema: z.number().int().min(1).max(24),
    default: 12,
    description: 'Duração máxima de uma sessão, mesmo com atividade (horas)',
  },
  'panel.recent_calls': {
    schema: z.number().int().min(1).max(20),
    default: 6,
    description: 'Quantidade de chamadas recentes exibidas no painel público',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFINITIONS;
export const SETTING_KEYS = Object.keys(SETTINGS_DEFINITIONS) as SettingKey[];

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_DEFINITIONS)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS_DEFINITIONS;
}
