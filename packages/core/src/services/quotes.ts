/**
 * Preventivi [ORD-01].
 *
 *  - numero progressivo per tenant assegnato nella stessa transazione della creazione;
 *  - righe da catalogo con SNAPSHOT di prezzo, costo e distinta: un cambio di listino
 *    successivo non altera i preventivi esistenti (spec ORD-01);
 *  - prezzi dei prodotti sempre letti dal DB, mai dal client; righe libere con prezzo del fiorista;
 *  - ogni modifica blocca la riga del preventivo (FOR UPDATE) e ricalcola i totali in
 *    transazione; il database verifica comunque la coerenza dei totali (CHECK);
 *  - costi e margini solo per chi ha `catalog:costs:read`.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PRICING_ENGINE_VERSION,
  QUOTE_LIMITS,
  QUOTE_PAGE_SIZE,
  QUOTE_STATUSES,
  canTransitionQuote,
  catalogQuoteLineSchema,
  computeRecipeCosting,
  customQuoteLineSchema,
  effectiveQuoteStatus,
  formatQuoteNumber,
  isIngredientType,
  isQuoteEditable,
  isUuid,
  quoteDetailsSchema,
  quoteLineQuantitySchema,
  quoteListFiltersSchema,
  toFieldErrors,
  todayInTimeZone,
  worstAvailability,
  type AcquisitionSource,
  type Availability,
  type CatalogItemType,
  type QuoteStatus,
  type SaleUnit,
} from '@floral/domain';
import { getObjectStorage } from '../ai/storage';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import {
  addDays,
  dateToParts,
  expireSentQuotes,
  formatDateParts,
  insertDraftQuote,
  lockQuote,
  partsToDate,
  recalculateTotals,
} from './quote-internals';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface QuoteSummaryDto {
  readonly id: string;
  readonly number: number;
  readonly numberLabel: string;
  readonly title: string | null;
  readonly customerId: string;
  readonly customerName: string;
  readonly status: QuoteStatus;
  readonly totalMinor: number;
  readonly currency: string;
  /** "AAAA-MM-GG" nel calendario del tenant. */
  readonly validUntil: string | null;
  readonly createdAt: Date;
  readonly lineCount: number;
}

export interface QuoteRecipeLineSnapshot {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  /** Colore di carta, vaso o nastro scelto nel Builder (assente negli snapshot precedenti). */
  readonly color?: string | null;
}

export interface QuoteLineDto {
  readonly id: string;
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly catalogItemId: string | null;
  /** Solo per righe BUILDER: il disegno di origine. */
  readonly bouquetConfigurationId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  /** null se non disponibile o se l'utente non può vedere i costi. */
  readonly unitCostMinor: number | null;
  readonly saleUnit: SaleUnit | null;
  /** Per le righe BUILDER: la disponibilità più critica fra i componenti. */
  readonly availability: Availability | null;
  readonly recipe: readonly QuoteRecipeLineSnapshot[] | null;
  /**
   * Righe BUILDER: immagine del ramo agganciata quando la riga è nata (ADR-035). `verified` =
   * numero di fiori ricontrollato (anteprima esatta); `simulated` = immagine di sviluppo.
   */
  readonly image: { readonly verified: boolean; readonly simulated: boolean } | null;
}

export interface QuoteDetailDto extends QuoteSummaryDto {
  readonly notes: string | null;
  readonly taxMode: string;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly acquisitionSource: AcquisitionSource;
  readonly statusChangedAt: Date | null;
  readonly customer: {
    readonly id: string;
    readonly displayName: string;
    readonly phone: string | null;
    readonly email: string | null;
  };
  readonly lines: readonly QuoteLineDto[];
  readonly editable: boolean;
  readonly allowedTransitions: readonly QuoteStatus[];
  readonly canWrite: boolean;
  readonly canViewCosts: boolean;
  /** Costo stimato dagli snapshot; null se manca anche un solo costo o non visibile. */
  readonly estimatedCostMinor: number | null;
  readonly estimatedMarginMinor: number | null;
}

interface LineSnapshot {
  readonly version: 1;
  readonly engine: string;
  readonly item?: {
    readonly name: string;
    readonly variety: string | null;
    readonly sku: string | null;
    readonly type: CatalogItemType;
    readonly saleUnit: SaleUnit;
    readonly availability: Availability;
  };
  readonly recipe?: readonly QuoteRecipeLineSnapshot[];
  /** Righe BUILDER: componenti con prezzo e disponibilità al momento del preventivo. */
  readonly components?: readonly { readonly availability: Availability }[];
}

function readSnapshot(value: Prisma.JsonValue | null): LineSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as LineSnapshot;
}

type QuoteWithRelations = Prisma.QuoteGetPayload<{
  include: {
    customer: { select: { id: true; displayName: true; phone: true; email: true } };
    _count: { select: { lines: true } };
  };
}>;

function toSummary(quote: QuoteWithRelations, ctx: TenantContext): QuoteSummaryDto {
  return {
    id: quote.id,
    number: quote.number,
    numberLabel: formatQuoteNumber(quote.number),
    title: quote.title,
    customerId: quote.customer.id,
    customerName: quote.customer.displayName,
    status: effectiveQuoteStatus(
      quote.status,
      dateToParts(quote.validUntil),
      todayInTimeZone(ctx.timezone),
    ),
    totalMinor: quote.totalMinor,
    currency: quote.currency,
    validUntil: formatDateParts(dateToParts(quote.validUntil)),
    createdAt: quote.createdAt,
    lineCount: quote._count.lines,
  };
}

const quoteInclude = {
  customer: { select: { id: true, displayName: true, phone: true, email: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.QuoteInclude;

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

export interface QuoteListResult {
  readonly items: readonly QuoteSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly canWrite: boolean;
}

export async function listQuotes(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<QuoteListResult> {
  requirePermission(ctx, 'quotes:read');
  const filters = quoteListFiltersSchema.parse(rawFilters ?? {});
  const numberMatch = /^(?:cot-?)?0*(\d{1,9})$/i.exec(filters.q);
  const where: Prisma.QuoteWhereInput = {
    tenantId: ctx.tenantId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { customer: { displayName: { contains: filters.q, mode: 'insensitive' } } },
            { title: { contains: filters.q, mode: 'insensitive' } },
            ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
          ],
        }
      : {}),
  };
  return withTenantContext(getDb(), ctx, async (tx) => {
    await expireSentQuotes(tx, ctx);
    const total = await tx.quote.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / QUOTE_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const quotes = await tx.quote.findMany({
      where,
      include: quoteInclude,
      orderBy: [{ number: 'desc' }],
      skip: (page - 1) * QUOTE_PAGE_SIZE,
      take: QUOTE_PAGE_SIZE,
    });
    return {
      items: quotes.map((quote) => toSummary(quote, ctx)),
      total,
      page,
      pageCount,
      canWrite: hasPermission(ctx, 'quotes:write'),
    };
  });
}

export async function listCustomerQuotes(
  ctx: TenantContext,
  customerId: string,
): Promise<readonly QuoteSummaryDto[]> {
  requirePermission(ctx, 'quotes:read');
  if (!isUuid(customerId)) return [];
  return withTenantContext(getDb(), ctx, async (tx) => {
    await expireSentQuotes(tx, ctx);
    const quotes = await tx.quote.findMany({
      where: { tenantId: ctx.tenantId, customerId },
      include: quoteInclude,
      orderBy: { number: 'desc' },
      take: 50,
    });
    return quotes.map((quote) => toSummary(quote, ctx));
  });
}

export async function getQuote(ctx: TenantContext, quoteId: string): Promise<QuoteDetailDto> {
  requirePermission(ctx, 'quotes:read');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const canViewCosts = hasPermission(ctx, 'catalog:costs:read');
  const canWrite = hasPermission(ctx, 'quotes:write');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await expireSentQuotes(tx, ctx);
    const quote = await tx.quote.findFirst({
      where: { id: quoteId, tenantId: ctx.tenantId },
      include: quoteInclude,
    });
    if (!quote) return null;
    const lines = await tx.quoteLine.findMany({
      where: { tenantId: ctx.tenantId, quoteId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        previewJob: { select: { status: true, provider: true, output: true, outputKey: true } },
      },
    });
    return { quote, lines };
  });
  if (!result) return notFound(ctx, 'Quote', quoteId);
  const { quote, lines } = result;

  const summary = toSummary(quote, ctx);
  const lineDtos: QuoteLineDto[] = lines.map((line) => {
    const snapshot = readSnapshot(line.snapshot);
    return {
      id: line.id,
      kind: line.kind,
      catalogItemId: line.catalogItemId,
      bouquetConfigurationId: line.bouquetConfigurationId,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      unitCostMinor: canViewCosts ? line.unitCostMinor : null,
      saleUnit: snapshot?.item?.saleUnit ?? null,
      availability:
        snapshot?.item?.availability ??
        worstAvailability((snapshot?.components ?? []).map((component) => component.availability)),
      recipe: snapshot?.recipe ?? null,
      image:
        line.previewJob?.status === 'SUCCEEDED' && line.previewJob.outputKey
          ? {
              verified:
                (line.previewJob.output as { verified?: unknown } | null)?.verified === true,
              simulated: line.previewJob.provider === 'simulated',
            }
          : null,
    };
  });
  const costKnown = lines.every((line) => line.unitCostMinor !== null);
  const estimatedCostMinor =
    canViewCosts && costKnown && lines.length > 0
      ? lines.reduce((sum, line) => sum + (line.unitCostMinor ?? 0) * line.quantity, 0)
      : null;

  return {
    ...summary,
    notes: quote.notes,
    taxMode: quote.taxMode,
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    taxMinor: quote.taxMinor,
    acquisitionSource: quote.acquisitionSource,
    statusChangedAt: quote.statusChangedAt,
    customer: quote.customer,
    lines: lineDtos,
    editable: canWrite && isQuoteEditable(summary.status),
    allowedTransitions: canWrite
      ? QUOTE_STATUSES.filter((to) => canTransitionQuote(summary.status, to))
      : [],
    canWrite,
    canViewCosts,
    estimatedCostMinor,
    estimatedMarginMinor:
      estimatedCostMinor !== null ? quote.totalMinor - estimatedCostMinor : null,
  };
}

// -----------------------------------------------------------------------------
// Scrittura
// -----------------------------------------------------------------------------

export async function createQuote(
  ctx: TenantContext,
  input: { readonly customerId: unknown },
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'quotes:write');
  const customerId = typeof input.customerId === 'string' ? input.customerId.trim() : '';
  if (!isUuid(customerId)) throw new ValidationError({ customerId: 'required' });
  const result = await withTenantContext(getDb(), ctx, (tx) =>
    insertDraftQuote(tx, ctx, customerId),
  );
  if (!result) return notFound(ctx, 'Customer', customerId);
  return result;
}

/** Carica e blocca un preventivo modificabile (DRAFT) del tenant. */
async function lockEditableQuote(tx: TransactionClient, ctx: TenantContext, quoteId: string) {
  const quote = await lockQuote(tx, ctx, quoteId);
  if (!quote) return null;
  if (!isQuoteEditable(quote.status)) throw new ConflictError('quote_not_editable');
  return quote;
}

export async function addCatalogItemToQuote(
  ctx: TenantContext,
  quoteId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const parsed = catalogQuoteLineSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockEditableQuote(tx, ctx, quoteId);
    if (!quote) return false;

    // Prezzo, costo e distinta SEMPRE dal catalogo del tenant (mai dal client).
    const item = await tx.catalogItem.findFirst({
      where: { id: input.catalogItemId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      include: {
        recipe: {
          include: {
            lines: {
              where: { tenantId: ctx.tenantId },
              include: { ingredient: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });
    if (!item) throw new ValidationError({ catalogItemId: 'invalid_option' });
    if (item.availability === 'OUT_OF_STOCK')
      throw new ValidationError({ catalogItemId: 'item_unavailable' });

    const existing = await tx.quoteLine.findFirst({
      where: { tenantId: ctx.tenantId, quoteId, kind: 'CATALOG_ITEM', catalogItemId: item.id },
    });
    if (existing) {
      // Stesso articolo: si somma la quantità mantenendo lo snapshot originale del prezzo.
      const quantity = existing.quantity + input.quantity;
      if (quantity > QUOTE_LIMITS.quantityMax)
        throw new ValidationError({ quantity: 'out_of_range' });
      await tx.quoteLine.update({
        where: { id: existing.id },
        data: { quantity, lineTotalMinor: quantity * existing.unitPriceMinor },
      });
    } else {
      const count = await tx.quoteLine.count({ where: { tenantId: ctx.tenantId, quoteId } });
      if (count >= QUOTE_LIMITS.lines) throw new ConflictError('quote_line_limit');

      let unitCostMinor = item.costMinor;
      let recipe: QuoteRecipeLineSnapshot[] | undefined;
      if (item.type === 'BOUQUET' && item.recipe) {
        recipe = item.recipe.lines.map((line) => ({
          name: line.ingredient.name,
          variety: line.ingredient.variety,
          quantity: line.quantity,
          saleUnit: line.ingredient.saleUnit,
        }));
        const costing = computeRecipeCosting({
          salePriceMinor: item.priceMinor,
          laborCostMinor: item.recipe.laborCostMinor,
          lines: item.recipe.lines.map((line) => ({
            quantity: line.quantity,
            unitPriceMinor: line.ingredient.priceMinor,
            unitCostMinor: line.ingredient.costMinor,
          })),
        });
        unitCostMinor = costing.totalCostMinor;
      }
      const snapshot: LineSnapshot = {
        version: 1,
        engine: PRICING_ENGINE_VERSION,
        item: {
          name: item.name,
          variety: item.variety,
          sku: item.sku,
          type: item.type,
          saleUnit: item.saleUnit,
          availability: item.availability,
        },
        ...(recipe ? { recipe } : {}),
      };
      await tx.quoteLine.create({
        data: {
          tenantId: ctx.tenantId,
          quoteId,
          kind: 'CATALOG_ITEM',
          catalogItemId: item.id,
          description: item.variety ? `${item.name} · ${item.variety}` : item.name,
          quantity: input.quantity,
          unitPriceMinor: item.priceMinor,
          unitCostMinor,
          lineTotalMinor: input.quantity * item.priceMinor,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          sortOrder: count,
        },
      });
    }
    await recalculateTotals(tx, ctx, quoteId);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteLineAdded,
      entityType: 'Quote',
      entityId: quoteId,
      metadata: {
        number: formatQuoteNumber(quote.number),
        itemName: item.name,
        quantity: input.quantity,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Quote', quoteId);
}

export async function addCustomLineToQuote(
  ctx: TenantContext,
  quoteId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const parsed = customQuoteLineSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockEditableQuote(tx, ctx, quoteId);
    if (!quote) return false;
    const count = await tx.quoteLine.count({ where: { tenantId: ctx.tenantId, quoteId } });
    if (count >= QUOTE_LIMITS.lines) throw new ConflictError('quote_line_limit');
    await tx.quoteLine.create({
      data: {
        tenantId: ctx.tenantId,
        quoteId,
        kind: 'CUSTOM',
        description: input.description,
        quantity: input.quantity,
        unitPriceMinor: input.unitPrice,
        unitCostMinor: null,
        lineTotalMinor: input.quantity * input.unitPrice,
        snapshot: { version: 1, engine: PRICING_ENGINE_VERSION } as Prisma.InputJsonValue,
        sortOrder: count,
      },
    });
    await recalculateTotals(tx, ctx, quoteId);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteLineAdded,
      entityType: 'Quote',
      entityId: quoteId,
      metadata: { number: formatQuoteNumber(quote.number), custom: true, quantity: input.quantity },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Quote', quoteId);
}

export async function updateQuoteLineQuantity(
  ctx: TenantContext,
  quoteId: string,
  lineId: string,
  rawQuantity: unknown,
): Promise<void> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId) || !isUuid(lineId)) throw new NotFoundError('QuoteLine');
  const parsed = quoteLineQuantitySchema.safeParse(rawQuantity);
  if (!parsed.success)
    throw new ValidationError({ quantity: parsed.error.issues[0]?.message ?? 'invalid' });
  const quantity = parsed.data;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockEditableQuote(tx, ctx, quoteId);
    if (!quote) return false;
    const line = await tx.quoteLine.findFirst({
      where: { id: lineId, tenantId: ctx.tenantId, quoteId },
    });
    if (!line) return false;
    if (line.quantity === quantity) return true;
    await tx.quoteLine.update({
      where: { id: line.id },
      data: { quantity, lineTotalMinor: quantity * line.unitPriceMinor },
    });
    await recalculateTotals(tx, ctx, quoteId);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteLineUpdated,
      entityType: 'Quote',
      entityId: quoteId,
      metadata: { number: formatQuoteNumber(quote.number), from: line.quantity, to: quantity },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'QuoteLine', lineId);
}

export async function removeQuoteLine(
  ctx: TenantContext,
  quoteId: string,
  lineId: string,
): Promise<void> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId) || !isUuid(lineId)) throw new NotFoundError('QuoteLine');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockEditableQuote(tx, ctx, quoteId);
    if (!quote) return false;
    const line = await tx.quoteLine.findFirst({
      where: { id: lineId, tenantId: ctx.tenantId, quoteId },
    });
    if (!line) return false;
    await tx.quoteLine.delete({ where: { id: line.id } });
    await recalculateTotals(tx, ctx, quoteId);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteLineRemoved,
      entityType: 'Quote',
      entityId: quoteId,
      metadata: { number: formatQuoteNumber(quote.number) },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'QuoteLine', lineId);
}

export async function updateQuoteDetails(
  ctx: TenantContext,
  quoteId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const parsed = quoteDetailsSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockEditableQuote(tx, ctx, quoteId);
    if (!quote) return false;
    if (input.discount > quote.subtotalMinor)
      throw new ValidationError({ discount: 'discount_exceeds_subtotal' });
    if (input.validUntil) {
      const today = todayInTimeZone(ctx.timezone);
      const until = partsToDate(input.validUntil).getTime();
      if (
        until < partsToDate(today).getTime() ||
        until > partsToDate(addDays(today, QUOTE_LIMITS.validityDaysMax)).getTime()
      ) {
        throw new ValidationError({ validUntil: 'out_of_range' });
      }
    }
    await tx.quote.update({
      where: { id: quote.id },
      data: {
        title: input.title,
        notes: input.notes,
        validUntil: input.validUntil ? partsToDate(input.validUntil) : null,
      },
    });
    await recalculateTotals(tx, ctx, quoteId, input.discount);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteUpdated,
      entityType: 'Quote',
      entityId: quote.id,
      metadata: { number: formatQuoteNumber(quote.number), discountMinor: input.discount },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Quote', quoteId);
}

export async function changeQuoteStatus(
  ctx: TenantContext,
  quoteId: string,
  rawStatus: unknown,
): Promise<QuoteStatus> {
  requirePermission(ctx, 'quotes:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const target = QUOTE_STATUSES.find((status) => status === rawStatus);
  if (!target) throw new ValidationError({ status: 'invalid_option' });

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await expireSentQuotes(tx, ctx);
    const quote = await lockQuote(tx, ctx, quoteId);
    if (!quote) return null;
    if (!canTransitionQuote(quote.status, target))
      throw new ConflictError('invalid_status_transition');
    if (target === 'SENT') {
      const lines = await tx.quoteLine.count({ where: { tenantId: ctx.tenantId, quoteId } });
      if (lines === 0) throw new ConflictError('quote_empty');
    }
    await tx.quote.update({
      where: { id: quote.id },
      data: { status: target, statusChangedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteStatusChanged,
      entityType: 'Quote',
      entityId: quote.id,
      metadata: { number: formatQuoteNumber(quote.number), from: quote.status, to: target },
    });
    return target;
  });
  if (!result) return notFound(ctx, 'Quote', quoteId);
  return result;
}

export interface QuotableItemOption {
  readonly id: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly saleUnit: SaleUnit;
  readonly priceMinor: number;
  readonly availability: Availability;
}

/** Articoli attivi e vendibili (non esauriti) per le righe dei preventivi. */
export async function listQuotableItems(
  ctx: TenantContext,
): Promise<readonly QuotableItemOption[]> {
  requirePermission(ctx, 'quotes:read');
  const items = await withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', availability: { not: 'OUT_OF_STOCK' } },
      select: {
        id: true,
        name: true,
        variety: true,
        type: true,
        saleUnit: true,
        priceMinor: true,
        availability: true,
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
  );
  // I bouquet prima, poi gli ingredienti, poi servizi e complementi.
  const rank = (type: CatalogItemType) => (type === 'BOUQUET' ? 0 : isIngredientType(type) ? 1 : 2);
  return [...items].sort((a, b) => rank(a.type) - rank(b.type));
}

/**
 * Immagine del ramo di una riga BUILDER (ADR-035), per la pagina e la stampa del preventivo: la
 * vede chi vede il preventivo (anche se il piano non include più il Builder: è già pagata).
 */
export async function getQuoteLineImage(
  ctx: TenantContext,
  quoteId: string,
  lineId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'quotes:read');
  if (!isUuid(quoteId) || !isUuid(lineId)) throw new NotFoundError('QuoteLine');
  const line = await withTenantContext(getDb(), ctx, (tx) =>
    tx.quoteLine.findFirst({
      where: { id: lineId, quoteId, tenantId: ctx.tenantId },
      select: {
        previewJob: { select: { status: true, outputKey: true, outputContentType: true } },
      },
    }),
  );
  if (!line) return notFound(ctx, 'QuoteLine', lineId);
  const job = line.previewJob;
  if (job?.status !== 'SUCCEEDED' || !job.outputKey) throw new NotFoundError('QuoteLine');
  const bytes = await getObjectStorage().get(job.outputKey);
  if (!bytes) throw new NotFoundError('QuoteLine');
  return { bytes, contentType: job.outputContentType ?? 'image/png' };
}
