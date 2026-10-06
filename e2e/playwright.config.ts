import { defineConfig } from '@playwright/test';

/**
 * Pré-requisitos: API e Web rodando (npm run dev) sobre um banco de DESENVOLVIMENTO com o seed aplicado
 * (npm run db:seed). Nunca rode contra produção — o teste cria pacientes e atendimentos fictícios.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Belem',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
