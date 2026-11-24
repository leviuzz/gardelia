import { execFileSync } from 'node:child_process';

/**
 * SQL sul database dell'E2E (stesso ruolo dell'app, con il bypass di sistema come
 * `withSystemContext`), per i casi che un utente non può creare dall'interfaccia, come "sono
 * passati 15 giorni".
 */
export function runSystemSql(sql: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL mancante per l'E2E");
  return execFileSync(
    'psql',
    [
      url,
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
      '-c',
      `SELECT set_config('app.bypass_rls', 'on', false); ${sql}`,
    ],
    { encoding: 'utf8' },
  );
}
