import { z } from 'zod';

/**
 * Configuração por variáveis de ambiente, validada na inicialização (falha cedo e com mensagem clara).
 * NENHUM segredo vive no código: senha do banco, chaves e afins só entram por ambiente (ver docs/ENVIRONMENT.md).
 */

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL é obrigatória.' })
    .regex(/^postgres(ql)?:\/\/.+\/.+/, 'DATABASE_URL deve ser uma URL PostgreSQL (postgresql://usuario:senha@host:5432/banco).'),
  /** Origens permitidas para CORS/CSRF, separadas por vírgula. */
  WEB_ORIGIN: z.string().min(1, 'WEB_ORIGIN é obrigatória.'),
  COOKIE_SECURE: z.string().optional(),
  /** Quantos proxies confiar para X-Forwarded-For (0 = nenhum). Com Nginx na frente, use 1. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  HOSPITAL_TIMEZONE: z.string().default('America/Belem'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Se definida, o painel público exige `?key=` (TV da recepção). Recomendado em produção. */
  PUBLIC_PANEL_KEY: z.string().min(16, 'PUBLIC_PANEL_KEY deve ter ao menos 16 caracteres.').optional().or(z.literal('').transform(() => undefined)),
  /** Parâmetros do argon2id (padrão: perfil recomendado pela OWASP). */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
  /** Tentativas de login antes do bloqueio temporário, e duração do bloqueio. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Limite global (req/min por sessão ou IP) e do login (req/min por IP). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(900),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(3).default(20),
});

export interface AppConfig {
  appEnv: 'development' | 'test' | 'staging' | 'production';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  databaseName: string;
  webOrigins: string[];
  cookieSecure: boolean;
  cookieName: string;
  trustProxy: number;
  timezone: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  publicPanelKey?: string;
  argon2: { memoryCost: number; timeCost: number };
  login: { maxAttempts: number; lockMinutes: number };
  rateLimit: { perMinute: number; loginPerMinute: number };
}

/** Segregação de ambientes: impede apontar desenvolvimento para banco de produção (e vice-versa) por engano. */
function assertEnvironmentSeparation(appEnv: AppConfig['appEnv'], dbName: string): void {
  const n = dbName.toLowerCase();
  const looksProd = /(^|[_-])(prod|production|producao)([_-]|$)/.test(n);
  const looksStaging = /(^|[_-])(staging|homolog|homologacao)([_-]|$)/.test(n);
  const looksDevOrTest = /(^|[_-])(dev|development|test|testes?)([_-]|$)/.test(n);
  if ((appEnv === 'production') && looksDevOrTest) {
    throw new Error(`Configuração insegura: APP_ENV=production com banco "${dbName}" que parece de desenvolvimento/teste.`);
  }
  if ((appEnv === 'development' || appEnv === 'test') && (looksProd || looksStaging)) {
    throw new Error(`Configuração insegura: APP_ENV=${appEnv} apontando para o banco "${dbName}" que parece de produção/homologação.`);
  }
  if (appEnv === 'staging' && (looksProd || looksDevOrTest)) {
    throw new Error(`Configuração insegura: APP_ENV=staging com banco "${dbName}" que parece de outro ambiente.`);
  }
}

export function parseConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Configuração de ambiente inválida:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isProduction = e.APP_ENV === 'production';
  const secureDefault = e.APP_ENV === 'production' || e.APP_ENV === 'staging';
  const cookieSecure = e.COOKIE_SECURE === undefined ? secureDefault : e.COOKIE_SECURE === 'true' || e.COOKIE_SECURE === '1';
  const webOrigins = e.WEB_ORIGIN.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(new URL(e.DATABASE_URL).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  assertEnvironmentSeparation(e.APP_ENV, databaseName);

  if (isProduction) {
    if (!cookieSecure) throw new Error('Em produção COOKIE_SECURE deve ser true (HTTPS obrigatório).');
    if (webOrigins.some((o) => !o.startsWith('https://'))) throw new Error('Em produção WEB_ORIGIN deve usar https://.');
  }

  return {
    appEnv: e.APP_ENV,
    isProduction,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databaseName,
    webOrigins,
    cookieSecure,
    cookieName: cookieSecure ? '__Host-hosp_session' : 'hosp_session',
    trustProxy: e.TRUST_PROXY,
    timezone: e.HOSPITAL_TIMEZONE,
    logLevel: e.LOG_LEVEL,
    publicPanelKey: e.PUBLIC_PANEL_KEY,
    argon2: { memoryCost: e.ARGON2_MEMORY_KIB, timeCost: e.ARGON2_TIME_COST },
    login: { maxAttempts: e.LOGIN_MAX_ATTEMPTS, lockMinutes: e.LOGIN_LOCK_MINUTES },
    rateLimit: { perMinute: e.RATE_LIMIT_PER_MINUTE, loginPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
