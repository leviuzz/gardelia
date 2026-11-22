/**
 * Allinea i dati di riferimento della piattaforma (tassonomia dei fiori) nel database indicato da
 * DATABASE_URL. Idempotente: gira a ogni rilascio dopo le migrazioni (`pnpm db:deploy`, build di
 * produzione su Vercel) e prima dei test di integrazione. Vedi src/reference-data.ts.
 */
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createDbClient } from '../src/client';
import { syncReferenceData } from '../src/reference-data';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL mancante: non so dove allineare i dati di riferimento.');
  process.exit(1);
}

const db = createDbClient({
  connectionString,
  poolMax: 1,
  applicationName: 'floral-reference-data',
});
try {
  const result = await syncReferenceData(db);
  console.info(`Dati di riferimento allineati: ${result.canonicalFlowers} fiori della tassonomia.`);
} finally {
  await db.$disconnect();
}
