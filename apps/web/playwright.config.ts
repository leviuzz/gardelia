import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end sull'app REALE in modalità produzione (`next start`), con database
 * (DATABASE_URL, seed demo) e un pozzo SMTP locale per leggere le email inviate.
 *
 * Prerequisiti: database migrato e build eseguita (`pnpm build`). Vedi README § Test.
 */
const PORT = Number(process.env.E2E_PORT ?? '3100');
export const MAIL_PORT = Number(process.env.E2E_MAIL_PORT ?? '1125');
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // I test condividono la fioreria demo: esecuzione seriale, deterministica.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      testMatch: /.*\.spec\.ts/,
      testIgnore: /mobile\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_URL: BASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      SMTP_URL: `smtp://127.0.0.1:${MAIL_PORT}`,
      EMAIL_FROM: 'Floral OS E2E <no-reply@e2e.floral.local>',
      NEXT_TELEMETRY_DISABLED: '1',
      // Anteprime AI con il provider simulato (solo locale) e archivio su file.
      AI_PROVIDER: 'simulated',
      AI_MONTHLY_BUDGET_USD: '50',
      STORAGE_DRIVER: 'filesystem',
      STORAGE_DIR: '.storage',
    },
  },
});
