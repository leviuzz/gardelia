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
  // Il tetto di spesa AI è di tutta la piattaforma e il database di test non si svuota fra
  // un'esecuzione e l'altra: in locale la spesa (finta) del mese cresce a ogni giro finché ogni
  // anteprima risponde `ai_budget_reached`. Qui un tetto altissimo; il test del tetto usa un
  // costo ancora più alto (ai-previews.test.ts).
  AI_MONTHLY_BUDGET_USD: '100000',
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
        // Utilità pure del web (configurazione, percorsi, traduzione degli errori): niente DB.
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
            'server-only': fileURLToPath(
              new URL('./apps/web/test/server-only-stub.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'web',
          root: './apps/web',
          include: ['test/**/*.test.ts'],
          environment: 'node',
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
