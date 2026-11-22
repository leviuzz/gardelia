/**
 * Promo delle date speciali (ADR-047): una volta al giorno manda l'email con lo sconto ai clienti
 * che hanno accettato di ricevere promozioni e hanno un'email, qualche giorno prima di ogni loro
 * data speciale (il preavviso della data, 7 giorni se non cambiato).
 *
 * Gira con i lavori giornalieri: Vercel Cron alle 9 del Messico (`/api/internal/maintenance`) e,
 * fuori da Vercel, il ciclo di manutenzione nel processo. Regole:
 *  - solo fiorerie reali (mai DEMO, ADR-016), attive e con la promo accesa (`app_occasion_promo_tenants`);
 *  - al massimo un'email per data e anno: la riga `OccasionPromoEmail` si crea PRIMA dell'invio
 *    (presa in carico unica), così due esecuzioni insieme non mandano due email;
 *  - un'email per data, con il suo codice personale (ADR-048): il cliente lo cita su WhatsApp e la
 *    fioreria lo verifica e lo segna come usato nella pagina Descuentos;
 *  - se l'invio fallisce si riprova nei giorni seguenti (fino a 3 tentativi) finché la data non
 *    è passata; un invio interrotto a metà non si ripete (meglio un'email in meno che una doppia).
 */
import { randomInt } from 'node:crypto';
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  PROMO_CODE_ALPHABET,
  PROMO_CODE_LENGTH,
  PROMO_LIMITS,
  activeDiscount,
  duePromoOccurrences,
  getMarket,
  isCurrencyCode,
  monthsInRange,
  promoLookaheadEnd,
  resolveLocale,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
  type CurrencyCode,
  type Discount,
  type DuePromo,
  type OccasionType,
} from '@floral/domain';
import { logger } from '../logger';
import type { Mailer } from '../mailer';
import { occasionPromoEmail } from '../promo-email';
import { createUnsubscribeToken, unsubscribeUrls } from '../promo-unsubscribe';

export interface OccasionPromoDeps {
  readonly mailer: Mailer;
  /** URL pubblico dell'app (link per non ricevere più promozioni). */
  readonly appUrl: string;
  /** Segreto dell'app: firma i link personali di disiscrizione. */
  readonly secret: string;
  /** Solo test: "adesso" per il calcolo dei giorni. */
  readonly now?: Date;
}

export interface OccasionPromoRunResult {
  readonly tenants: number;
  readonly sent: number;
  readonly failed: number;
}

/** Una presa in carico ferma da più di un'ora è un invio interrotto (processo fermato). */
const STALE_SENDING_MS = 60 * 60 * 1000;

interface DueOccasion {
  readonly id: string;
  readonly customerId: string;
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  readonly month: number;
  readonly day: number;
  readonly remindDaysBefore: number;
  readonly customer: { readonly displayName: string; readonly email: string | null };
}

interface Claim {
  readonly id: string;
  readonly code: string;
  readonly entry: DuePromo<DueOccasion>;
}

/**
 * Codice personale a caso (6 caratteri dall'alfabeto senza 0/O né 1/I): unico nella fioreria
 * per il vincolo del database; nel caso rarissimo di un doppione la riga non si crea e l'email
 * parte il giorno dopo con un altro codice.
 */
export function newPromoCode(): string {
  let code = '';
  for (let index = 0; index < PROMO_CODE_LENGTH; index++) {
    code += PROMO_CODE_ALPHABET.charAt(randomInt(PROMO_CODE_ALPHABET.length));
  }
  return code;
}

interface TenantPlan {
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  readonly country: string;
  readonly currency: CurrencyCode;
  readonly discount: Discount;
  readonly claims: readonly Claim[];
}

function dbDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function occurrenceKey(occasionId: string, date: Date | CalendarDate): string {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : toIsoDate(date);
  return `${occasionId}:${iso}`;
}

export async function runOccasionPromos(deps: OccasionPromoDeps): Promise<OccasionPromoRunResult> {
  const now = deps.now ?? new Date();
  const rows = await getDb().$queryRaw<{ tenant_id: string }[]>`
    SELECT tenant_id FROM app_occasion_promo_tenants()`;
  let sent = 0;
  let failed = 0;
  for (const { tenant_id: tenantId } of rows) {
    try {
      const result = await runForTenant(tenantId, deps, now);
      sent += result.sent;
      failed += result.failed;
    } catch (error) {
      // Una fioreria con un problema non ferma le altre.
      logger.error({ err: error, tenantId }, 'promo delle date speciali non riuscita');
    }
  }
  const result = { tenants: rows.length, sent, failed };
  logger.info(result, 'promo delle date speciali completata');
  return result;
}

/** Legge cosa c'è da mandare oggi e prende in carico le email (righe SENDING). */
async function planTenant(
  tx: TransactionClient,
  tenantId: string,
  now: Date,
): Promise<TenantPlan | null> {
  const tenant = await tx.tenant.findFirst({
    where: { id: tenantId },
    select: {
      displayName: true,
      contactEmail: true,
      contactPhone: true,
      marketCountry: true,
      currency: true,
      timezone: true,
      status: true,
      mode: true,
      occasionPromoEnabled: true,
      occasionPromoKind: true,
      occasionPromoValue: true,
    },
  });
  // Ricontrollo (difesa in profondità): mai una fioreria demo, sospesa o con la promo spenta.
  if (!tenant || tenant.mode !== 'LIVE' || tenant.status !== 'ACTIVE') return null;
  if (!tenant.occasionPromoEnabled || !isCurrencyCode(tenant.currency)) return null;
  const discount = activeDiscount({
    enabled: true,
    kind: tenant.occasionPromoKind,
    value: tenant.occasionPromoValue,
  });
  if (!discount) return null;

  await tx.occasionPromoEmail.updateMany({
    where: {
      tenantId,
      status: 'SENDING',
      updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) },
    },
    data: { status: 'FAILED', lastError: 'interrupted', attempts: PROMO_LIMITS.maxAttempts },
  });

  const today = todayInTimeZone(tenant.timezone, now);
  const occasions: DueOccasion[] = await tx.customerOccasion.findMany({
    where: {
      tenantId,
      month: { in: monthsInRange(today, promoLookaheadEnd(today)) },
      customer: { status: 'ACTIVE', marketingConsent: true, email: { not: null } },
    },
    select: {
      id: true,
      customerId: true,
      type: true,
      label: true,
      personName: true,
      month: true,
      day: true,
      remindDaysBefore: true,
      customer: { select: { displayName: true, email: true } },
    },
    orderBy: { id: 'asc' },
  });
  const due = duePromoOccurrences(occasions, today);
  const shop = {
    name: tenant.displayName,
    contactEmail: tenant.contactEmail,
    contactPhone: tenant.contactPhone,
  };
  const base = { shop, country: tenant.marketCountry, currency: tenant.currency, discount };
  if (due.length === 0) return { ...base, claims: [] };

  const dueByKey = new Map(
    due.map((entry) => [occurrenceKey(entry.occasion.id, entry.date), entry]),
  );
  const existing = await tx.occasionPromoEmail.findMany({
    where: { tenantId, occasionId: { in: due.map((entry) => entry.occasion.id) } },
    select: { id: true, occasionId: true, occurrenceDate: true, status: true, attempts: true },
  });
  const known = new Set(existing.map((row) => occurrenceKey(row.occasionId, row.occurrenceDate)));
  const snapshot = {
    discountKind: discount.kind,
    discountValue: discount.value,
    currency: tenant.currency,
  };
  const select = { id: true, occasionId: true, occurrenceDate: true, code: true } as const;

  const fresh = due.filter((entry) => !known.has(occurrenceKey(entry.occasion.id, entry.date)));
  const created =
    fresh.length === 0
      ? []
      : await tx.occasionPromoEmail.createManyAndReturn({
          data: fresh.map((entry) => ({
            tenantId,
            occasionId: entry.occasion.id,
            customerId: entry.occasion.customerId,
            occurrenceDate: dbDate(entry.date),
            code: newPromoCode(),
            ...snapshot,
          })),
          // Un'altra esecuzione l'ha già presa: non la si manda una seconda volta.
          skipDuplicates: true,
          select,
        });
  const retryIds = existing
    .filter(
      (row) =>
        row.status === 'FAILED' &&
        row.attempts < PROMO_LIMITS.maxAttempts &&
        dueByKey.has(occurrenceKey(row.occasionId, row.occurrenceDate)),
    )
    .map((row) => row.id);
  const retried =
    retryIds.length === 0
      ? []
      : await tx.occasionPromoEmail.updateManyAndReturn({
          where: {
            tenantId,
            id: { in: retryIds },
            status: 'FAILED',
            attempts: { lt: PROMO_LIMITS.maxAttempts },
          },
          // Lo sconto è quello di oggi: l'email precedente non era partita, nulla era promesso.
          data: { status: 'SENDING', attempts: { increment: 1 }, lastError: null, ...snapshot },
          select,
        });

  const claims: Claim[] = [];
  for (const row of [...created, ...retried]) {
    const entry = dueByKey.get(occurrenceKey(row.occasionId, row.occurrenceDate));
    if (entry) claims.push({ id: row.id, code: row.code, entry });
  }
  return { ...base, claims };
}

async function runForTenant(
  tenantId: string,
  deps: OccasionPromoDeps,
  now: Date,
): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const scope = { tenantId, userId: null } as const;
  const plan = await withTenantContext(db, scope, (tx) => planTenant(tx, tenantId, now));
  if (!plan || plan.claims.length === 0) return { sent: 0, failed: 0 };

  const locale = resolveLocale(getMarket(plan.country).defaultLocale);
  let sent = 0;
  let failed = 0;
  for (const claim of plan.claims) {
    const { occasion } = claim.entry;
    const customerId = occasion.customerId;
    let delivered = false;
    if (occasion.customer.email) {
      const urls = unsubscribeUrls(
        deps.appUrl,
        createUnsubscribeToken(deps.secret, { tenantId, customerId }),
      );
      try {
        await deps.mailer.send(
          occasionPromoEmail({
            locale,
            to: occasion.customer.email,
            customerName: occasion.customer.displayName,
            shop: plan.shop,
            currency: plan.currency,
            discount: plan.discount,
            occasion: {
              type: occasion.type,
              label: occasion.label,
              personName: occasion.personName,
              date: claim.entry.date,
            },
            code: claim.code,
            unsubscribeUrl: urls.page,
            oneClickUnsubscribeUrl: urls.oneClick,
          }),
        );
        delivered = true;
      } catch (error) {
        logger.warn({ err: error, tenantId, customerId }, 'email della promo non partita');
      }
    }
    // Esito salvato subito dopo ogni invio: un'interruzione lascia al massimo un'email in sospeso.
    await withTenantContext(db, scope, (tx) =>
      tx.occasionPromoEmail.updateMany({
        where: { tenantId, id: claim.id },
        data: delivered
          ? { status: 'SENT', sentAt: now, lastError: null }
          : { status: 'FAILED', lastError: 'send_failed' },
      }),
    );
    if (delivered) sent += 1;
    else failed += 1;
  }
  logger.info({ tenantId, sent, failed }, 'promo delle date speciali: fioreria servita');
  return { sent, failed };
}
