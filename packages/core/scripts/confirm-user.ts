/**
 * CLI di piattaforma: conferma a mano l'email di una persona che conosci (registrata da sola,
 * con la sua password) e, se serve, la aggiunge a una fioreria (ADR-050). Serve finché il
 * dominio email non è verificato: le email di conferma arrivano solo al titolare di Resend.
 *
 *   pnpm platform:confirm-user --operator <email SUPER_ADMIN> --email <email della persona> \
 *     [--tenant <slug> --role MANAGER|STAFF]
 *
 * Conferma solo persone che conosci: chi conferma garantisce che l'email è davvero sua.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { confirmUserAccess } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:confirm-user --operator <email> --email <email della persona>
                             [--tenant <slug> --role MANAGER|STAFF]`;

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      email: { type: 'string' },
      tenant: { type: 'string' },
      role: { type: 'string' },
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
  const result = await confirmUserAccess({
    operatorEmail: values.operator,
    email: values.email,
    tenantSlug: values.tenant ?? null,
    role: values.role ?? null,
  });
  console.info(
    result.emailConfirmed
      ? 'Email confermata: la persona ora può entrare con la sua password.'
      : "L'email era già confermata.",
  );
  if (result.membership) {
    console.info(
      result.membership.added
        ? `Aggiunta alla fioreria "${result.membership.tenantSlug}" come ${result.membership.role}.`
        : `Era già nel team di "${result.membership.tenantSlug}" (${result.membership.role}): nessun cambio.`,
    );
  } else {
    console.info(
      'Al primo accesso, se non ha una fioreria, la crea lei (nome, telefono, indirizzo).',
    );
  }
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
