/**
 * Contesti di accesso al database e Row-Level Security.
 *
 * Ogni accesso ai dati dei tenant passa da una transazione che imposta il contesto
 * con `set_config(..., true)` (valido solo per quella transazione, sicuro anche con
 * pool di connessioni/PgBouncer in transaction mode). Le policy RLS (migrazione
 * `tenant_rls`) filtrano le righe in base a quel contesto.
 *
 *  - withTenantContext: operazioni di un utente dentro una fioreria (caso normale).
 *  - withUserContext:   operazioni dell'utente prima di scegliere una fioreria
 *                       (elenco delle proprie fiorerie, risoluzione dello slug).
 *  - withSystemContext: operazioni di sistema ESPLICITE che superano la RLS
 *                       (seed, accettazione invito via token, controlli di sicurezza).
 *                       Richiede una motivazione, registrata nei log.
 *
 * Questi helper sono una rete di sicurezza: i servizi applicano comunque filtri
 * espliciti su `tenantId` in ogni query (difesa in profondità).
 */
import type { DbClient } from './client';
import type { Prisma } from './generated/prisma/client.ts';

export type TransactionClient = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Attesa massima per ottenere una connessione dal pool (ms). */
  readonly maxWait?: number;
  /** Durata massima della transazione (ms). Le chiamate a provider esterni NON vanno qui dentro. */
  readonly timeout?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

export interface TenantScope {
  readonly tenantId: string;
  /** Utente che agisce; null per job di sistema eseguiti per conto del tenant. */
  readonly userId: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} non è un UUID valido`);
  }
}

const DEFAULT_TX: Required<Pick<TransactionOptions, 'maxWait' | 'timeout'>> = {
  maxWait: 5_000,
  timeout: 15_000,
};

type SystemContextListener = (event: { reason: string }) => void;
let systemContextListener: SystemContextListener | null = null;

/** Permette al livello applicativo di registrare (log/metriche) ogni uso del contesto di sistema. */
export function onSystemContext(listener: SystemContextListener | null): void {
  systemContextListener = listener;
}

export async function withTenantContext<T>(
  db: DbClient,
  scope: TenantScope,
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertUuid(scope.tenantId, 'tenantId');
  if (scope.userId !== null) assertUuid(scope.userId, 'userId');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`;
      return fn(tx);
    },
    { ...DEFAULT_TX, ...options },
  );
}

export async function withUserContext<T>(
  db: DbClient,
  userId: string,
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertUuid(userId, 'userId');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    },
    { ...DEFAULT_TX, ...options },
  );
}

export async function withSystemContext<T>(
  db: DbClient,
  context: { readonly reason: string },
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  if (context.reason.trim().length < 5) {
    throw new TypeError('withSystemContext richiede una motivazione esplicita');
  }
  systemContextListener?.({ reason: context.reason });
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    },
    { ...DEFAULT_TX, ...options },
  );
}

export interface RlsSafetyReport {
  readonly role: string;
  readonly isSuperuser: boolean;
  readonly canBypassRls: boolean;
  /** true se il ruolo connesso è soggetto alle policy RLS. */
  readonly rlsEffective: boolean;
}

/**
 * Verifica che il ruolo connesso NON possa aggirare la RLS (superuser o BYPASSRLS).
 * L'app lo controlla all'avvio e si rifiuta di partire in produzione se non è sicuro.
 */
export async function checkRlsSafety(db: DbClient): Promise<RlsSafetyReport> {
  const rows = await db.$queryRaw<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user AS role, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user`;
  const row = rows[0];
  if (!row) throw new Error('Impossibile leggere gli attributi del ruolo database corrente');
  return {
    role: row.role,
    isSuperuser: row.rolsuper,
    canBypassRls: row.rolbypassrls,
    rlsEffective: !row.rolsuper && !row.rolbypassrls,
  };
}
