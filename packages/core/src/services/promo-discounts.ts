/**
 * Registro degli sconti della promo (ADR-048, richiesta del founder): ogni email partita è uno
 * sconto con il suo codice. Quando un cliente scrive su WhatsApp "ho questo sconto", la fioreria
 * cerca il codice (o il nome), vede se è suo, se vale ancora o se è già stato usato, e lo segna
 * come usato. Tutto resta tracciato: chi, quando e una nota.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PROMO_DISCOUNT_PAGE_SIZE,
  formatPromoCode,
  isUuid,
  normalizePromoCode,
  promoDiscountFiltersSchema,
  promoDiscountStatus,
  promoRedemptionSchema,
  toFieldErrors,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
  type CurrencyCode,
  type Discount,
  type OccasionType,
  type PromoDiscountStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export interface PromoDiscountDto {
  readonly id: string;
  /** "K7M-4QH", come nell'email. */
  readonly code: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly occasion: {
    readonly type: OccasionType;
    readonly label: string | null;
    readonly personName: string | null;
  };
  /** Giorno della data speciale: lo sconto vale fino a qui compreso ("AAAA-MM-GG"). */
  readonly validUntil: string;
  readonly discount: Discount;
  readonly currency: CurrencyCode;
  readonly sentAt: string;
  readonly status: PromoDiscountStatus;
  readonly redeemedAt: string | null;
  readonly redeemedByName: string | null;
  readonly note: string | null;
}

export interface PromoDiscountListResult {
  readonly items: readonly PromoDiscountDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  /** Totali per stato, senza filtri (riepilogo). */
  readonly counts: Readonly<Record<PromoDiscountStatus, number>>;
}

const discountSelect = {
  id: true,
  code: true,
  customerId: true,
  occurrenceDate: true,
  discountKind: true,
  discountValue: true,
  currency: true,
  sentAt: true,
  redeemedAt: true,
  redeemedById: true,
  redemptionNote: true,
  customer: { select: { displayName: true } },
  occasion: { select: { type: true, label: true, personName: true } },
} as const satisfies Prisma.OccasionPromoEmailSelect;

type DiscountRow = Prisma.OccasionPromoEmailGetPayload<{ select: typeof discountSelect }>;

function dbDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function calendarDate(value: Date): CalendarDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** Solo le email partite sono sconti: le altre il cliente non le ha mai ricevute. */
function statusWhere(
  status: PromoDiscountStatus | null,
  today: Date,
): Prisma.OccasionPromoEmailWhereInput {
  if (status === 'USED') return { redeemedAt: { not: null } };
  if (status === 'VALID') return { redeemedAt: null, occurrenceDate: { gte: today } };
  if (status === 'EXPIRED') return { redeemedAt: null, occurrenceDate: { lt: today } };
  return {};
}

async function toDtos(
  tx: TransactionClient,
  rows: readonly DiscountRow[],
  today: CalendarDate,
): Promise<PromoDiscountDto[]> {
  const userIds = [...new Set(rows.map((row) => row.redeemedById).filter((id) => id !== null))];
  const users = userIds.length
    ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) => {
    const validUntil = calendarDate(row.occurrenceDate);
    return {
      id: row.id,
      code: formatPromoCode(row.code),
      customerId: row.customerId,
      customerName: row.customer.displayName,
      occasion: row.occasion,
      validUntil: toIsoDate(validUntil),
      discount: { kind: row.discountKind, value: row.discountValue },
      currency: row.currency as CurrencyCode,
      sentAt: (row.sentAt ?? row.occurrenceDate).toISOString(),
      status: promoDiscountStatus({ redeemed: row.redeemedAt !== null, validUntil }, today),
      redeemedAt: row.redeemedAt?.toISOString() ?? null,
      redeemedByName: row.redeemedById ? (names.get(row.redeemedById) ?? null) : null,
      note: row.redemptionNote,
    };
  });
}

/**
 * Sconti inviati, dal più recente: si cerca per codice (in qualsiasi forma: "k7m 4qh"), nome,
 * email o telefono del cliente, e si filtra per stato (validi, usati, scaduti).
 */
export async function listPromoDiscounts(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<PromoDiscountListResult> {
  requirePermission(ctx, 'promotions:manage');
  const filters = promoDiscountFiltersSchema.parse(rawFilters ?? {});
  const today = todayInTimeZone(ctx.timezone);
  const todayDb = dbDate(today);
  const base: Prisma.OccasionPromoEmailWhereInput = { tenantId: ctx.tenantId, status: 'SENT' };
  const code = normalizePromoCode(filters.q);
  const digits = filters.q.replace(/\D/g, '');
  const search: Prisma.OccasionPromoEmailWhereInput = filters.q
    ? {
        OR: [
          ...(code ? [{ code }] : []),
          {
            customer: {
              OR: [
                { displayName: { contains: filters.q, mode: 'insensitive' } },
                { email: { contains: filters.q, mode: 'insensitive' } },
                ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
              ],
            },
          },
        ],
      }
    : {};
  const where: Prisma.OccasionPromoEmailWhereInput = {
    ...base,
    ...statusWhere(filters.status, todayDb),
    ...search,
  };
  return withTenantContext(getDb(), ctx, async (tx) => {
    const total = await tx.occasionPromoEmail.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PROMO_DISCOUNT_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.occasionPromoEmail.findMany({
      where,
      select: discountSelect,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PROMO_DISCOUNT_PAGE_SIZE,
      take: PROMO_DISCOUNT_PAGE_SIZE,
    });
    const counts = {
      VALID: await tx.occasionPromoEmail.count({
        where: { ...base, ...statusWhere('VALID', todayDb) },
      }),
      USED: await tx.occasionPromoEmail.count({
        where: { ...base, ...statusWhere('USED', todayDb) },
      }),
      EXPIRED: await tx.occasionPromoEmail.count({
        where: { ...base, ...statusWhere('EXPIRED', todayDb) },
      }),
    };
    return { items: await toDtos(tx, rows, today), total, page, pageCount, counts };
  });
}

/** Sconti inviati a un cliente (scheda del cliente), dal più recente. */
export async function listCustomerPromoDiscounts(
  ctx: TenantContext,
  customerId: string,
): Promise<readonly PromoDiscountDto[]> {
  requirePermission(ctx, 'customers:read');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const today = todayInTimeZone(ctx.timezone);
  return withTenantContext(getDb(), ctx, async (tx) => {
    const rows = await tx.occasionPromoEmail.findMany({
      where: { tenantId: ctx.tenantId, customerId, status: 'SENT' },
      select: discountSelect,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return toDtos(tx, rows, today);
  });
}

/** true se chi guarda può segnare gli sconti come usati. */
export function canRedeemPromoDiscounts(ctx: TenantContext): boolean {
  return hasPermission(ctx, 'promotions:manage');
}

/**
 * Segna lo sconto come usato (con una nota facoltativa, es. il preventivo). Anche uno scaduto: la
 * fioreria decide, e il registro mostra quando è stato usato rispetto alla scadenza.
 */
export async function redeemPromoDiscount(
  ctx: TenantContext,
  discountId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'promotions:manage');
  const parsed = promoRedemptionSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  if (!isUuid(discountId)) throw new NotFoundError('OccasionPromoEmail');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const row = await tx.occasionPromoEmail.findFirst({
      where: { id: discountId, tenantId: ctx.tenantId },
      select: { id: true, status: true, redeemedAt: true, customerId: true },
    });
    if (!row) return false;
    if (row.status !== 'SENT') throw new ConflictError('promo_not_sent');
    if (row.redeemedAt) throw new ConflictError('promo_already_used');
    await tx.occasionPromoEmail.update({
      where: { id: row.id },
      data: {
        redeemedAt: new Date(),
        redeemedById: ctx.userId,
        redemptionNote: parsed.data.note,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.promoRedeemed,
      entityType: 'OccasionPromoEmail',
      entityId: row.id,
      metadata: { customerId: row.customerId },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'OccasionPromoEmail', discountId);
}

/** Toglie il segno di "usato" (uno sbaglio): lo sconto torna valido o scaduto secondo la data. */
export async function undoPromoRedemption(ctx: TenantContext, discountId: string): Promise<void> {
  requirePermission(ctx, 'promotions:manage');
  if (!isUuid(discountId)) throw new NotFoundError('OccasionPromoEmail');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const row = await tx.occasionPromoEmail.findFirst({
      where: { id: discountId, tenantId: ctx.tenantId },
      select: { id: true, redeemedAt: true, customerId: true },
    });
    if (!row) return false;
    if (!row.redeemedAt) return true;
    await tx.occasionPromoEmail.update({
      where: { id: row.id },
      data: { redeemedAt: null, redeemedById: null, redemptionNote: null },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.promoRedemptionUndone,
      entityType: 'OccasionPromoEmail',
      entityId: row.id,
      metadata: { customerId: row.customerId },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'OccasionPromoEmail', discountId);
}
