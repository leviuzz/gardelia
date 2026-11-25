/**
 * CLI di piattaforma: sblocca crediti pagati alla piattaforma. Predefinito: anteprime AI extra;
 * con `--feature plant-assistant` le consultas dell'Asistente de plantas (ADR-085).
 *
 *   pnpm platform:grant-ai-credits --operator <email SUPER_ADMIN> --tenant <slug> \
 *     --units 50 [--feature bouquet-preview|plant-assistant] \
 *     [--note "Paquete 50 · transferencia 2026-11-21"]
 *
 * Non inserire dati personali nella nota: finisce nel registro di audit.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { AppError, ValidationError } from '../src/errors';
import { grantAiCredits, type GrantableAiFeature } from '../src/platform';

const USAGE = `Uso:
  pnpm platform:grant-ai-credits --operator <email> --tenant <slug> --units <1-10000>
                                 [--feature bouquet-preview|plant-assistant] [--note "testo"]`;

const FEATURES: Record<string, GrantableAiFeature> = {
  'bouquet-preview': 'BOUQUET_PREVIEW',
  'plant-assistant': 'PLANT_ASSISTANT',
};

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      tenant: { type: 'string' },
      units: { type: 'string' },
      feature: { type: 'string' },
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
  const feature = FEATURES[values.feature ?? 'bouquet-preview'];
  if (!feature) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');
  const result = await grantAiCredits({
    operatorEmail: values.operator,
    tenantSlug: values.tenant,
    units: Number(values.units),
    feature,
    note: values.note ?? null,
  });
  const what =
    result.feature === 'PLANT_ASSISTANT' ? "crediti dell'Asistente de plantas" : 'anteprime extra';
  console.info(
    `Sbloccati ${result.units} ${what} per "${result.tenantSlug}" (totale concesso: ${result.totalGranted}).`,
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
