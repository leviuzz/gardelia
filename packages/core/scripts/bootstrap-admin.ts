/**
 * CLI di piattaforma: nomina il PRIMO amministratore (SUPER_ADMIN) della piattaforma, necessario
 * per assegnare piani e crediti con le altre CLI. Funziona una sola volta: se esiste già un
 * amministratore si rifiuta. L'utente deve essersi registrato e aver confermato l'email.
 *
 *   pnpm platform:bootstrap-admin --email <email>
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { bootstrapPlatformAdmin } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:bootstrap-admin --email <email>`;

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: { email: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    strict: true,
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  if (!values.email) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');
  await bootstrapPlatformAdmin({ email: values.email });
  console.info('Primo amministratore della piattaforma nominato.');
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      console.error(`Operazione rifiutata: ${error.message}`);
      if (error instanceof ValidationError) console.error(error.fieldErrors);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
