/**
 * Ambiente de TESTE. DATABASE_URL vem de apps/api/.env.test (não versionado — ver .env.test.example) ou do CI.
 * Os demais valores abaixo não são segredos: só tornam a suíte rápida e determinística.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// override: o @prisma/client carrega apps/api/.env (desenvolvimento) sozinho ao ser importado — o .env.test precisa prevalecer
config({ path: resolve(__dirname, '..', '.env.test'), override: true });

const defaults: Record<string, string> = {
  APP_ENV: 'test',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
  HOSPITAL_TIMEZONE: 'America/Belem',
  ARGON2_MEMORY_KIB: '1024',
  ARGON2_TIME_COST: '1',
  RATE_LIMIT_PER_MINUTE: '100000',
  LOGIN_RATE_LIMIT_PER_MINUTE: '100000',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] = process.env[k] && k !== 'APP_ENV' ? process.env[k] : v;
process.env.APP_ENV = 'test';
