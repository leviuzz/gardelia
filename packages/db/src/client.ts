import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';
import { SerialClient } from './serial-client.ts';

export type DbClient = PrismaClient;

export interface CreateDbClientOptions {
  readonly connectionString: string;
  /** Connessioni massime del pool per processo. */
  readonly poolMax?: number;
  readonly applicationName?: string;
}

/**
 * Crea un client Prisma con driver adapter `pg` (Prisma 7). Ogni connessione del pool esegue
 * una query alla volta (`SerialClient`): dentro una transazione Prisma le lancia anche in
 * parallelo, e pg 9 non le accetterà più.
 */
export function createDbClient({
  connectionString,
  poolMax = 10,
  applicationName = 'floral-os',
}: CreateDbClientOptions): DbClient {
  const adapter = new PrismaPg({
    connectionString,
    max: poolMax,
    application_name: applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    Client: SerialClient,
  });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as typeof globalThis & { __floralDb?: DbClient };

/**
 * Client condiviso del processo, configurato da DATABASE_URL (ruolo applicativo).
 * In sviluppo viene riutilizzato fra i reload di Next.js per non esaurire le connessioni.
 *
 * ATTENZIONE: le tabelle dei tenant sono protette da RLS. Usare SEMPRE gli helper di
 * `tenancy.ts` (withTenantContext / withUserContext / withSystemContext): una query
 * fatta direttamente con questo client vede zero righe nelle tabelle dei tenant.
 */
export function getDb(): DbClient {
  if (!globalForDb.__floralDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL non è configurata (vedi .env.example).');
    }
    const poolMax = Number(process.env.DATABASE_POOL_MAX ?? '10');
    globalForDb.__floralDb = createDbClient({
      connectionString,
      poolMax: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : 10,
    });
  }
  return globalForDb.__floralDb;
}

export async function disconnectDb(): Promise<void> {
  if (globalForDb.__floralDb) {
    await globalForDb.__floralDb.$disconnect();
    delete globalForDb.__floralDb;
  }
}
