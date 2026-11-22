/**
 * Build su Vercel. Prima di `next build`, SOLO nei deploy di produzione, applica le migrazioni
 * del database con il ruolo proprietario (`DATABASE_MIGRATION_URL`). Le anteprime per ramo non
 * toccano mai il database. Le migrazioni sono "espandi e contrai" (PLATFORM_PLAN §4): la
 * versione in linea continua a funzionare mentre arriva la nuova.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const run = (command, cwd) => execSync(command, { stdio: 'inherit', cwd });

if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DATABASE_MIGRATION_URL) {
    console.error(
      'DATABASE_MIGRATION_URL mancante: senza le migrazioni il deploy di produzione si ferma.',
    );
    process.exit(1);
  }
  console.info('Deploy di produzione: applico le migrazioni del database.');
  run('pnpm --filter @floral/db run migrate:deploy', repoRoot);
} else {
  console.info(`Deploy "${process.env.VERCEL_ENV ?? 'locale'}": nessuna migrazione.`);
}

run('pnpm exec next build', appDir);
