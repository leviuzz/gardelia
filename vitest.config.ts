import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Variabili da `.env` (root). In CI arrivano già dall'ambiente e hanno la precedenza.
loadEnv({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

/**
 * I test di integrazione usano SEMPRE il database di test, mai quello di sviluppo:
 * DATABASE_URL viene sovrascritta con TEST_DATABASE_URL (ruolo applicativo, soggetto a RLS).
 */
const integrationEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL ?? '',
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.LOG_LEVEL_TEST ?? 'silent',
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'domain',
          root: './packages/domain',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          root: './packages/db',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          env: integrationEnv,
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          env: integrationEnv,
          globalSetup: ['../db/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
