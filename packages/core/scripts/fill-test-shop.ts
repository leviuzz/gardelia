/**
 * CLI di piattaforma: riempie una TUA fioreria di dati di prova (clienti con date speciali nel
 * calendario, fiori, verde, carte e nastri; facoltativamente le foto dei fiori).
 *
 *   pnpm platform:test-data --operator <email SUPER_ADMIN> --tenant <slug> [--photos <modo>]
 *
 * Modi delle foto:
 *   none (predefinito)  nessuna foto;
 *   fal                 una foto generata per ogni fiore e verde (AI_PROVIDER=fal, FAL_KEY e
 *                       l'archivio dell'ambiente: ~0,08 USD a foto, ADR-049);
 *   placeholder         cerchi colorati, SOLO in locale (archivio su disco).
 *
 * Rilanciarla aggiunge solo ciò che manca. Con uno scontornatore configurato, alla fine lavora
 * subito gli scontorni delle foto nuove (altrimenti aspetterebbero il prossimo giro della coda).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { disconnectDb } from '@floral/db';
import { getBackgroundRemover } from '../src/ai/background-remover';
import { FalImageProvider } from '../src/ai/fal';
import { getAiProvider } from '../src/ai/providers';
import { drainAiQueue } from '../src/ai/worker';
import { storageConfig } from '../src/config';
import { AppError, ValidationError } from '../src/errors';
import {
  TEST_CATALOG,
  fillTestShop,
  placeholderTestPhoto,
  testPhotoPrompt,
  type TestPhotoSource,
} from '../src/platform';

const USAGE = `Uso:
  pnpm platform:test-data --operator <email> --tenant <slug> [--photos none|fal|placeholder]`;

const PHOTO_MODES = ['none', 'fal', 'placeholder'] as const;
type PhotoMode = (typeof PHOTO_MODES)[number];

/** Tempo massimo per una foto generata (fal risponde di solito in 10-20 s). */
const PHOTO_TIMEOUT_MS = 120_000;
/** Tempo per gli scontorni delle foto nuove (pochi secondi l'uno). */
const CUTOUT_BUDGET_MS = 10 * 60_000;
const CUTOUT_RESERVE_MS = 60_000;

/**
 * L'archivio su disco (solo locale) è relativo alla cartella da cui parte l'app web: la CLI parte
 * da packages/core, quindi lo punta lì, o l'app non troverebbe le foto. Prima di leggere la
 * configurazione (che poi resta in memoria).
 */
function useWebAppStorageDir(): void {
  const dir = process.env.STORAGE_DIR?.trim() || '.storage';
  if (path.isAbsolute(dir)) return;
  const webApp = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
  process.env.STORAGE_DIR = path.resolve(webApp, dir);
}

function isPhotoMode(value: string): value is PhotoMode {
  return (PHOTO_MODES as readonly string[]).includes(value);
}

function photoSource(mode: PhotoMode): TestPhotoSource | undefined {
  if (mode === 'none') return undefined;
  if (mode === 'placeholder') {
    // Le foto finte non devono mai arrivare in un ambiente online (ADR-016): solo archivio su disco,
    // che a sua volta è ammesso solo con un APP_URL locale (config.ts).
    if (storageConfig().STORAGE_DRIVER !== 'filesystem') {
      throw new Error(
        '--photos placeholder è solo per lo sviluppo locale (STORAGE_DRIVER=filesystem).',
      );
    }
    return placeholderTestPhoto;
  }
  // Il fornitore vero (mai quello simulato): genera dal solo testo, senza un ramo da disegnare.
  const provider = getAiProvider();
  if (!(provider instanceof FalImageProvider)) {
    throw new Error('--photos fal richiede AI_PROVIDER=fal e FAL_KEY.');
  }
  return async (item) => {
    const image = await provider.generate({
      prompt: testPhotoPrompt(item),
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    return image.bytes;
  };
}

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  useWebAppStorageDir();
  const { values } = parseArgs({
    options: {
      operator: { type: 'string' },
      tenant: { type: 'string' },
      photos: { type: 'string', default: 'none' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  const mode = values.photos;
  if (!values.operator || !values.tenant || !isPhotoMode(mode)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata.');
  const photo = photoSource(mode);
  if (mode === 'fal') {
    const count = TEST_CATALOG.filter((item) => item.photo !== null).length;
    console.info(`Genero fino a ${count} foto con fal (~${(count * 0.08).toFixed(2)} USD)…`);
  }

  const result = await fillTestShop({
    operatorEmail: values.operator,
    tenantSlug: values.tenant,
    ...(photo ? { photo } : {}),
  });
  console.info(`Fioreria "${result.tenantSlug}":`);
  console.info(
    `  clienti: ${result.customers.created} nuovi (${result.dates} date speciali), ${result.customers.existing} già presenti`,
  );
  console.info(`  prodotti: ${result.items.created} nuovi, ${result.items.existing} già presenti`);
  if (photo) {
    console.info(
      `  foto: ${result.photos.added} aggiunte, ${result.photos.existing} già presenti, ${result.photos.failed} non riuscite`,
    );
  }

  if (result.photos.added > 0 && getBackgroundRemover()) {
    console.info('Preparo gli scontorni delle foto nuove…');
    const drained = await drainAiQueue({
      budgetMs: CUTOUT_BUDGET_MS,
      reserveMs: CUTOUT_RESERVE_MS,
      onlyTenantId: result.tenantId,
    });
    console.info(
      drained.stoppedBecause === 'idle'
        ? `  scontorni pronti (${drained.processed} lavori).`
        : `  ${drained.processed} lavori fatti; gli altri li finisce la coda dell'app.`,
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
