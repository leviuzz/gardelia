/**
 * CLI di piattaforma: assegna il piano a una fioreria durante il pilota (C-03).
 * Nessun pagamento: è un'assegnazione manuale, tracciata nell'audit del tenant.
 *
 *   pnpm platform:assign-plan --operator <email SUPER_ADMIN> --tenant <slug> \
 *     --plan PLUS --status PILOT [--until 2027-03-31] [--note "Piloto Aguascalientes"]
 *
 * --until AAAA-MM-GG: l'accesso termina alla FINE di quel giorno (America/Mexico_City,
 * UTC−6 tutto l'anno). In alternativa un istante ISO 8601 completo.
 * Non inserire dati personali nella nota: finisce nel registro di audit.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { assignTenantPlan } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:assign-plan --operator <email> --tenant <slug> --plan <BASIC|PLUS>
                            --status <PILOT|TRIALING|ACTIVE|CANCELLED>
                            [--until AAAA-MM-GG | <ISO 8601>] [--note "testo"]`;

function parseUntil(value: string | undefined): Date | null {
  if (!value) return null;
  // Data semplice: fine del giorno a Città del Messico (UTC−6, senza ora legale dal 2022).
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T23:59:59.999-06:00` : value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError({ until: 'invalid_date' });
  return parsed;
}

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      tenant: { type: 'string' },
      plan: { type: 'string' },
      status: { type: 'string' },
      until: { type: 'string' },
      note: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  if (!values.operator || !values.tenant || !values.plan || !values.status) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');

  const result = await assignTenantPlan({
    operatorEmail: values.operator,
    tenantSlug: values.tenant,
    planCode: values.plan.toUpperCase(),
    status: values.status.toUpperCase(),
    currentPeriodEnd: parseUntil(values.until),
    note: values.note ?? null,
  });
  const previous = result.previous
    ? `${result.previous.planCode}/${result.previous.status}`
    : 'nessuno';
  const until = result.currentPeriodEnd ? result.currentPeriodEnd.toISOString() : 'senza scadenza';
  console.info(
    `Piano assegnato a "${result.tenantSlug}": ${result.planCode}/${result.status} (${until}). Precedente: ${previous}.`,
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
