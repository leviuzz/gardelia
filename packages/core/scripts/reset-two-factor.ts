/**
 * CLI di piattaforma: toglie la verifica in due passaggi a una persona che ha perso il telefono e i
 * codici di respaldo, e chiude tutte le sue sessioni (ADR-077). Prima verifica chi è davvero (per
 * esempio una videochiamata o il telefono della fioreria): chi la toglie garantisce per lei.
 *
 *   pnpm platform:reset-two-factor --operator <email SUPER_ADMIN> --email <email della persona>
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { resetUserTwoFactor } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:reset-two-factor --operator <email> --email <email della persona>`;

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      email: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  if (!values.operator || !values.email) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');
  const result = await resetUserTwoFactor({ operatorEmail: values.operator, email: values.email });
  console.info(
    result.wasEnabled
      ? 'Verifica in due passaggi tolta: la persona entra con la sua password e, se è titolare, la riattiva.'
      : 'La persona non aveva la verifica in due passaggi attiva.',
  );
  console.info(`Sessioni chiuse: ${result.sessionsClosed}.`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      console.error(`Operazione rifiutata: ${error.message}`);
      if (error instanceof ValidationError) console.error(error.fieldErrors);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
