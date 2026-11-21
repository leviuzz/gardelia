import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Unica fonte delle variabili d'ambiente in sviluppo: `.env` nella root del monorepo.
// Le variabili già presenti nell'ambiente (CI, produzione) hanno la precedenza.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

/**
 * Configurazione Prisma CLI (migrazioni, generate, studio).
 *
 * Le migrazioni girano con il ruolo PROPRIETARIO dello schema (DATABASE_MIGRATION_URL),
 * mentre l'applicazione usa un ruolo senza privilegi di bypass RLS (DATABASE_URL).
 * Vedi docs/ARCHITECTURE.md § "Isolamento dei tenant".
 *
 * `prisma generate` non richiede una connessione: per questo l'URL è facoltativo qui
 * (in CI la generazione del client avviene prima che il database sia disponibile).
 */
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const shadowUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(migrationUrl
    ? {
        datasource: {
          url: migrationUrl,
          ...(shadowUrl ? { shadowDatabaseUrl: shadowUrl } : {}),
        },
      }
    : {}),
});
