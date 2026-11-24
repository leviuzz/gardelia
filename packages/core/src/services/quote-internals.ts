/**
 * Funzioni interne condivise dai servizi che creano o modificano preventivi (preventivi e
 * Bouquet Builder). NON esportate da `@floral/core`: lavorano dentro una transazione già
 * aperta con il contesto del tenant e presuppongono permessi già verificati.
 */
import type { TransactionClient } from '@floral/db';
import { AUDIT_ACTIONS, formatQuoteNumber, priceQuote, todayInTimeZone } from '@floral/domain';
import { recordAudit } from '../audit';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Le colonne `@db.Date` arrivano come mezzanotte UTC. */
export function dateToParts(date: Date | null): DateParts | null {
  if (!date) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function partsToDate(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function formatDateParts(parts: DateParts | null): string | null {
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Prossimo valore di un contatore del tenant (atomico, dentro la transazione corrente). */
export async function nextTenantCounter(
  tx: TransactionClient,
  tenantId: string,
  key: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "TenantCounter" ("tenantId", "key", "value", "updatedAt")
    VALUES (${tenantId}::uuid, ${key}, 1, now())
    ON CONFLICT ("tenantId", "key")
    DO UPDATE SET "value" = "TenantCounter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (typeof value !== 'number') throw new Error('Contatore non disponibile');
  return value;
}

/** Blocca la riga del preventivo fino alla fine della transazione e la restituisce. */
export async function lockQuote(tx: TransactionClient, ctx: TenantContext, quoteId: string) {
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  return tx.quote.findFirst({ where: { id: quoteId, tenantId: ctx.tenantId } });
}

export async function recalculateTotals(
  tx: TransactionClient,
  ctx: TenantContext,
  quoteId: string,
  discountMinor?: number,
) {
  const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId, tenantId: ctx.tenantId } });
  const lines = await tx.quoteLine.findMany({
    where: { tenantId: ctx.tenantId, quoteId },
    select: { quantity: true, unitPriceMinor: true },
  });
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  // Se le righe calano sotto lo sconto, lo sconto si riduce al subtotale.
  const requested = discountMinor ?? quote.discountMinor;
  const totals = priceQuote({ lines, discountMinor: Math.min(requested, subtotal) });
  if (!totals.ok) throw new ValidationError({ discount: totals.error });
  await tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
    },
  });
}

/**
 * Crea un preventivo in bozza per un cliente ATTIVO del tenant (numero progressivo nella
 * stessa transazione). Restituisce null se il cliente non esiste nel tenant. `from`: il contratto
 * di Floral Care da cui nasce e il titolo proposto (ADR-078); chi chiama ha già controllato che il
 * contratto sia della fioreria e di quel cliente.
 */
export async function insertDraftQuote(
  tx: TransactionClient,
  ctx: TenantContext,
  customerId: string,
  from: { readonly subscriptionId?: string; readonly title?: string } = {},
): Promise<{ id: string; number: number } | null> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, acquisitionSource: true },
  });
  if (!customer) return null;
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { quoteValidityDays: true },
  });
  const number = await nextTenantCounter(tx, ctx.tenantId, 'quote');
  const validUntil = partsToDate(addDays(todayInTimeZone(ctx.timezone), tenant.quoteValidityDays));
  const quote = await tx.quote.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      customerId: customer.id,
      currency: ctx.currency,
      validUntil,
      // L'origine del cliente si propaga al preventivo (attribuzione delle fee future).
      acquisitionSource: customer.acquisitionSource,
      subscriptionId: from.subscriptionId ?? null,
      title: from.title ?? null,
      createdById: ctx.userId,
      statusChangedAt: new Date(),
    },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.quoteCreated,
    entityType: 'Quote',
    entityId: quote.id,
    metadata: { number: formatQuoteNumber(number), customerId: customer.id },
  });
  return { id: quote.id, number };
}
