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
 *  - withPortalContext: la pagina del cliente di Floral Care (ADR-084), solo le righe del
 *                       contratto aperto dalla persona invitata.
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

/**
 * Marketplace M3 (ADR-088): chi ha fatto un ordine online agisce su quell'ordine (messaggi, segno di
 * lettura, «Annulla»). È il contesto della fioreria dell'ordine con chi compra come utente, più
 * `app.buyer_order_id`: le policy RESTRICTIVE `buyer_order_guard` lasciano toccare solo le righe di
 * quell'ordine. La fioreria e l'ordine li trova il servizio con `app_buyer_order_shop`, mai dal
 * browser; il proprietario dell'ordine lo ricontrolla sotto lock.
 */
export interface BuyerOrderScope {
  readonly tenantId: string;
  /** Solo dalla sessione. */
  readonly userId: string;
  readonly orderId: string;
}

export async function withBuyerOrderContext<T>(
  db: DbClient,
  scope: BuyerOrderScope,
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertUuid(scope.tenantId, 'tenantId');
  assertUuid(scope.userId, 'userId');
  assertUuid(scope.orderId, 'orderId');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId}, true), set_config('app.buyer_order_id', ${scope.orderId}, true)`;
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

/**
 * Floral Care, pagina del cliente (ADR-084): il contratto aperto da una persona invitata, come lo
 * ha trovato `app_portal_enter` (fioreria e termini: il portale non può leggerli da sé).
 */
export interface PortalEntry {
  readonly tenantId: string;
  readonly customerId: string;
  readonly subscriptionId: string;
  /** "Puede ver precios y cobros". */
  readonly canSeeMoney: boolean;
  /** Contratto finito: si legge ancora per 30 giorni, non si cambia. */
  readonly readOnly: boolean;
  readonly shop: {
    readonly slug: string;
    readonly name: string;
    readonly timezone: string;
    readonly marketCountry: string;
    readonly currency: string;
    readonly mode: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  readonly termsText: string | null;
}

export interface PortalScope {
  /** Solo dalla sessione: mai un ID arrivato dal browser. */
  readonly userId: string;
  readonly subscriptionId: string;
}

interface PortalEntryRow {
  tenant_id: string;
  customer_id: string;
  subscription_id: string;
  can_see_money: boolean;
  read_only: boolean;
  shop_slug: string;
  shop_name: string;
  shop_timezone: string;
  shop_market: string;
  shop_currency: string;
  shop_mode: string;
  shop_email: string | null;
  shop_phone: string | null;
  terms_text: string | null;
}

async function enterPortal(
  tx: TransactionClient,
  subscriptionId: string,
): Promise<PortalEntry | null> {
  const rows = await tx.$queryRaw<
    PortalEntryRow[]
  >`SELECT * FROM app_portal_enter(${subscriptionId}::uuid)`;
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    canSeeMoney: row.can_see_money,
    readOnly: row.read_only,
    shop: {
      slug: row.shop_slug,
      name: row.shop_name,
      timezone: row.shop_timezone,
      marketCountry: row.shop_market.trim(),
      currency: row.shop_currency.trim(),
      mode: row.shop_mode,
      contactEmail: row.shop_email,
      contactPhone: row.shop_phone,
    },
    termsText: row.terms_text,
  };
}

/**
 * Legge un contratto dal portale. La transazione ha solo la persona (`app.user_id`); è
 * `app_portal_enter`, nel database, a controllare l'accesso e a impostare fioreria, cliente e
 * contratto. Senza `app.tenant_id` le tabelle della fioreria non danno nulla, tranne le righe
 * delle policy `portal_read` di quel contratto; ogni scrittura è rifiutata.
 *
 * Restituisce null se la persona non ha accesso: il servizio risponde 404, come quando `fn` non
 * trova la riga e restituisce null.
 */
export async function withPortalContext<T>(
  db: DbClient,
  scope: PortalScope,
  fn: (tx: TransactionClient, entry: PortalEntry) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T | null> {
  assertUuid(scope.userId, 'userId');
  assertUuid(scope.subscriptionId, 'subscriptionId');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${scope.userId}, true)`;
      const entry = await enterPortal(tx, scope.subscriptionId);
      return entry ? fn(tx, entry) : null;
    },
    { ...DEFAULT_TX, ...options },
  );
}

/**
 * Scrive dal portale ("Cambiar fecha"): il contesto della fioreria (i posti si contano sulle
 * visite di tutti i clienti) più `app_portal_enter`, che rifiuta un contratto di un'altra
 * fioreria e accende la guardia `portal_write_guard` sulle visite. `tenantId` viene solo da
 * `app_buyer_care_contracts()`. Null senza accesso.
 */
export async function withPortalWriteContext<T>(
  db: DbClient,
  scope: PortalScope & { readonly tenantId: string },
  fn: (tx: TransactionClient, entry: PortalEntry) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T | null> {
  assertUuid(scope.userId, 'userId');
  assertUuid(scope.tenantId, 'tenantId');
  assertUuid(scope.subscriptionId, 'subscriptionId');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId}, true)`;
      const entry = await enterPortal(tx, scope.subscriptionId);
      return entry ? fn(tx, entry) : null;
    },
    { ...DEFAULT_TX, ...options },
  );
}

export interface RlsSafetyReport {
  readonly role: string;
  readonly isSuperuser: boolean;
  readonly canBypassRls: boolean;
  /**
   * true se il ruolo connesso possiede (o può diventare, con SET ROLE) il proprietario di una
   * tabella dello schema: potrebbe togliere la RLS con un ALTER TABLE.
   */
  readonly ownsTables: boolean;
  /** true se il ruolo connesso è soggetto alle policy RLS e non può toglierle. */
  readonly rlsEffective: boolean;
}

/**
 * Verifica che il ruolo connesso NON possa aggirare la RLS: né superuser, né BYPASSRLS, né
 * proprietario delle tabelle (il ruolo delle migrazioni). L'app lo controlla all'avvio e si
 * rifiuta di partire in produzione se non è sicuro.
 */
export async function checkRlsSafety(db: DbClient): Promise<RlsSafetyReport> {
  const rows = await db.$queryRaw<
    { role: string; rolsuper: boolean; rolbypassrls: boolean; ownsTables: boolean }[]
  >`
    SELECT current_user AS role, r.rolsuper, r.rolbypassrls,
           EXISTS (
             SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
               AND pg_has_role(current_user, c.relowner, 'MEMBER')
           ) AS "ownsTables"
    FROM pg_roles r WHERE r.rolname = current_user`;
  const row = rows[0];
  if (!row) throw new Error('Impossibile leggere gli attributi del ruolo database corrente');
  return {
    role: row.role,
    isSuperuser: row.rolsuper,
    canBypassRls: row.rolbypassrls,
    ownsTables: row.ownsTables,
    rlsEffective: !row.rolsuper && !row.rolbypassrls && !row.ownsTables,
  };
}
