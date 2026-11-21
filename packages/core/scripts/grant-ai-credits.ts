/**
 * CLI di piattaforma: sblocca anteprime AI extra (pacchetto pagato alla piattaforma).
 *
 *   pnpm platform:grant-ai-credits --operator <email SUPER_ADMIN> --tenant <slug> \
 *     --units 50 [--note "Paquete 50 · transferencia 2026-11-21"]
 *
 * Non inserire dati personali nella nota: finisce nel registro di audit.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { grantAiCredits } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:grant-ai-credits --operator <email> --tenant <slug> --units <1-10000>
                                 [--note "testo"]`;

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      tenant: { type: 'string' },
      units: { type: 'string' },
      note: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  if (!values.operator || !values.tenant || !values.units) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');
  const result = await grantAiCredits({
    operatorEmail: values.operator,
    tenantSlug: values.tenant,
    units: Number(values.units),
    note: values.note ?? null,
  });
  console.info(
    `Sbloccate ${result.units} anteprime extra per "${result.tenantSlug}" (totale concesso: ${result.totalGranted}).`,
  );
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
