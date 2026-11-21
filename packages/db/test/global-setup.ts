/**
 * Prepara il database di TEST prima dei test di integrazione: applica le migrazioni
 * (idempotente). Gira nel processo principale di Vitest, una volta per progetto.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  const appUrl = process.env.TEST_DATABASE_URL;
  const migrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
  if (!appUrl || !migrationUrl) {
    throw new Error(
      'TEST_DATABASE_URL e TEST_DATABASE_MIGRATION_URL sono obbligatorie per i test di integrazione (vedi .env.example).',
    );
  }
  // Protezione contro l'uso accidentale del database di sviluppo o produzione.
  for (const url of [appUrl, migrationUrl]) {
    const dbName = new URL(url).pathname.replace(/^\//, '');
    if (!/test/i.test(dbName)) {
      throw new Error(
        `Il database dei test deve contenere "test" nel nome (trovato: "${dbName}").`,
      );
    }
  }

  const dbPackageDir = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
    stdio: 'pipe',
  });
}
