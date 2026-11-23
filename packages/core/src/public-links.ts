/**
 * Link pubblici di preventivi e ordini, lato cliente (ADR-056). Il cliente non ha una sessione:
 * fioreria e link vengono SOLO dal token verificato (firma HMAC, `signed-ids.ts`), il link deve
 * essere attivo e non scaduto, e i dati si leggono nel contesto di quella fioreria (RLS attiva),
 * mai con un contesto di sistema. Si espone solo ciò che il cliente deve vedere: niente costi,
 * margini, note interne o dati di altri clienti.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  canAcceptQuoteOnline,
  effectiveQuoteStatus,
  formatOrderNumber,
  formatQuoteNumber,
  formatTimeOfDay,
  getMarket,
  isUuid,
  orderBalanceMinor,
  resolveLocale,
  todayInTimeZone,
  type FulfillmentMode,
  type OrderStatus,
  type PublicLinkKind,
  type QuoteStatus,
  type SaleUnit,
  type SupportedLocale,
} from '@floral/domain';
import type { RequestMeta } from './context';
import { NotFoundError } from './errors';
import { logger } from './logger';
import { readStoredImage, type StoredImage } from './media/stored-files';
import { dateToParts, formatDateParts } from './services/quote-internals';
import { readIdPair, signIdPair } from './signed-ids';

const TOKEN_CONTEXT = 'gardelia:public-link:v1';

/** Token del link (64 caratteri URL-safe): fioreria + ID del link + firma. */
export function createPublicLinkToken(
  secret: string,
  ids: { readonly tenantId: string; readonly linkId: string },
): string {
  return signIdPair(secret, TOKEN_CONTEXT, ids.tenantId, ids.linkId);
}

function readPublicLinkToken(
  secret: string,
  token: unknown,
): { readonly tenantId: string; readonly linkId: string } | null {
  const ids = readIdPair(secret, TOKEN_CONTEXT, token);
  return ids ? { tenantId: ids[0], linkId: ids[1] } : null;
}

/** Indirizzi pubblici: `/cotizacion/<token>` e `/pedido/<token>`. */
export function publicLinkUrl(appUrl: string, kind: PublicLinkKind, token: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/${kind === 'QUOTE' ? 'cotizacion' : 'pedido'}/${token}`;
}

export interface PublicShopDto {
  readonly name: string;
  readonly phone: string | null;
  /** Lingua del mercato della fioreria: la pagina parla come i messaggi al cliente (ADR-042). */
  readonly locale: SupportedLocale;
  readonly timezone: string;
}

interface LinkScope {
  readonly tenantId: string;
  readonly quoteId: string | null;
  readonly orderId: string | null;
  readonly shop: PublicShopDto;
}

async function withActiveLink<T>(
  secret: string,
  token: unknown,
  kind: PublicLinkKind,
  fn: (tx: TransactionClient, scope: LinkScope) => Promise<T | null>,
): Promise<T | null> {
  const ids = readPublicLinkToken(secret, token);
  if (!ids) return null;
  return withTenantContext(getDb(), { tenantId: ids.tenantId, userId: null }, async (tx) => {
    const link = await tx.publicLink.findFirst({
      where: {
        tenantId: ids.tenantId,
        id: ids.linkId,
        kind,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { quoteId: true, orderId: true },
    });
    if (!link) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ids.tenantId },
      select: {
        displayName: true,
        contactPhone: true,
        marketCountry: true,
        timezone: true,
        locations: { where: { isPrimary: true }, select: { phone: true }, take: 1 },
      },
    });
    return fn(tx, {
      tenantId: ids.tenantId,
      quoteId: link.quoteId,
      orderId: link.orderId,
      shop: {
        name: tenant.displayName,
        phone: tenant.contactPhone ?? tenant.locations[0]?.phone ?? null,
        locale: resolveLocale(getMarket(tenant.marketCountry).defaultLocale),
        timezone: tenant.timezone,
      },
    });
  });
}

interface SnapshotView {
  readonly item?: { readonly saleUnit?: SaleUnit };
  readonly recipe?: readonly PublicRecipeItem[];
}

function readSnapshot(value: Prisma.JsonValue | null): SnapshotView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as SnapshotView;
}

export interface PublicRecipeItem {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly color?: string | null;
}

export interface PublicLineDto {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly saleUnit: SaleUnit | null;
  readonly lineTotalMinor: number;
  readonly recipe: readonly PublicRecipeItem[] | null;
  readonly hasImage: boolean;
}

const lineSelect = {
  id: true,
  description: true,
  quantity: true,
  unitPriceMinor: true,
  lineTotalMinor: true,
  snapshot: true,
  bouquetPhotoId: true,
  previewJob: { select: { status: true, outputKey: true } },
} as const;

function toPublicLine(line: {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  snapshot: Prisma.JsonValue;
  bouquetPhotoId: string | null;
  previewJob: { status: string; outputKey: string | null } | null;
}): PublicLineDto {
  const snapshot = readSnapshot(line.snapshot);
  return {
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    saleUnit: snapshot?.item?.saleUnit ?? null,
    lineTotalMinor: line.lineTotalMinor,
    // Solo nomi e quantità della distinta: mai prezzi unitari dei componenti né costi.
    recipe:
      snapshot?.recipe?.map((item) => ({
        name: item.name,
        variety: item.variety,
        quantity: item.quantity,
        color: item.color ?? null,
      })) ?? null,
    hasImage:
      line.bouquetPhotoId !== null ||
      (line.previewJob?.status === 'SUCCEEDED' && line.previewJob.outputKey !== null),
  };
}

// -----------------------------------------------------------------------------
// Preventivo
// -----------------------------------------------------------------------------

export interface PublicQuoteDto {
  readonly shop: PublicShopDto;
  readonly numberLabel: string;
  /** Stato effettivo: un inviato oltre la validità è scaduto. */
  readonly status: QuoteStatus;
  readonly title: string | null;
  /** "Notas para el cliente". */
  readonly notes: string | null;
  readonly customerName: string;
  readonly createdAt: Date;
  /** "AAAA-MM-GG" o null. */
  readonly validUntil: string | null;
  readonly currency: string;
  readonly lines: readonly PublicLineDto[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly canAccept: boolean;
  /** Quando è stato accettato (dal link o dalla fioreria). */
  readonly acceptedAt: Date | null;
}

export async function getPublicQuote(
  secret: string,
  token: unknown,
): Promise<PublicQuoteDto | null> {
  return withActiveLink(secret, token, 'QUOTE', async (tx, scope) => {
    if (!scope.quoteId) return null;
    const quote = await tx.quote.findFirst({
      where: { tenantId: scope.tenantId, id: scope.quoteId },
      include: { customer: { select: { displayName: true } } },
    });
    if (!quote) return null;
    const lines = await tx.quoteLine.findMany({
      where: { tenantId: scope.tenantId, quoteId: quote.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: lineSelect,
    });
    const status = effectiveQuoteStatus(
      quote.status,
      dateToParts(quote.validUntil),
      todayInTimeZone(scope.shop.timezone),
    );
    return {
      shop: scope.shop,
      numberLabel: formatQuoteNumber(quote.number),
      status,
      title: quote.title,
      notes: quote.notes,
      customerName: quote.customer.displayName,
      createdAt: quote.createdAt,
      validUntil: formatDateParts(dateToParts(quote.validUntil)),
      currency: quote.currency,
      lines: lines.map(toPublicLine),
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      taxMinor: quote.taxMinor,
      totalMinor: quote.totalMinor,
      canAccept: canAcceptQuoteOnline(status),
      acceptedAt: quote.status === 'ACCEPTED' ? quote.statusChangedAt : null,
    };
  });
}

export type AcceptQuoteResult = 'accepted' | 'unavailable';

/**
 * "Aceptar cotización" dal link: solo un preventivo inviato e ancora valido. Registrato
 * nell'attività della fioreria senza utente (il cliente non ha un account). Null se il link non
 * vale più.
 */
export async function acceptPublicQuote(
  secret: string,
  token: unknown,
  request: RequestMeta = {},
): Promise<AcceptQuoteResult | null> {
  return withActiveLink(secret, token, 'QUOTE', async (tx, scope) => {
    if (!scope.quoteId) return null;
    const [quote] = await tx.$queryRaw<
      { id: string; number: number; status: QuoteStatus; validUntil: Date | null }[]
    >`SELECT "id", "number", "status", "validUntil" FROM "Quote"
      WHERE "id" = ${scope.quoteId}::uuid AND "tenantId" = ${scope.tenantId}::uuid FOR UPDATE`;
    if (!quote) return null;
    const status = effectiveQuoteStatus(
      quote.status,
      dateToParts(quote.validUntil),
      todayInTimeZone(scope.shop.timezone),
    );
    if (!canAcceptQuoteOnline(status)) return 'unavailable';
    await tx.quote.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED', statusChangedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        tenantId: scope.tenantId,
        actorUserId: null,
        action: AUDIT_ACTIONS.quoteAcceptedOnline,
        entityType: 'Quote',
        entityId: quote.id,
        metadata: { number: formatQuoteNumber(quote.number), from: quote.status, to: 'ACCEPTED' },
        requestId: request.requestId ?? null,
        ipAddress: request.ipAddress ?? null,
      },
    });
    logger.info({ tenantId: scope.tenantId, quoteId: quote.id }, 'preventivo accettato dal link');
    return 'accepted' as const;
  });
}

// -----------------------------------------------------------------------------
// Ordine
// -----------------------------------------------------------------------------

export interface PublicOrderDto {
  readonly shop: PublicShopDto;
  readonly numberLabel: string;
  readonly status: OrderStatus;
  readonly fulfillmentMode: FulfillmentMode;
  /** "AAAA-MM-GG". */
  readonly scheduledDate: string;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly deliveryAddress: {
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly neighborhood: string | null;
    readonly city: string;
    readonly region: string;
    readonly postalCode: string;
  } | null;
  readonly recipientName: string | null;
  readonly cardMessage: string | null;
  readonly cardSignature: string | null;
  readonly cardAnonymous: boolean;
  readonly currency: string;
  readonly lines: readonly PublicLineDto[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly deliveryFeeMinor: number;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  /** Passi già fatti, dal primo all'ultimo (senza il borrador). */
  readonly history: readonly { readonly status: OrderStatus; readonly at: Date }[];
}

export async function getPublicOrder(
  secret: string,
  token: unknown,
): Promise<PublicOrderDto | null> {
  return withActiveLink(secret, token, 'ORDER', async (tx, scope) => {
    if (!scope.orderId) return null;
    const order = await tx.order.findFirst({
      where: { tenantId: scope.tenantId, id: scope.orderId },
    });
    // Un borrador non si condivide (e uno scartato non ha data): il link non vale.
    if (!order || order.status === 'DRAFT' || !order.scheduledDate) return null;
    const lines = await tx.orderLine.findMany({
      where: { tenantId: scope.tenantId, orderId: order.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: lineSelect,
    });
    const events = await tx.orderStatusEvent.findMany({
      where: { tenantId: scope.tenantId, orderId: order.id },
      orderBy: [{ createdAt: 'asc' }],
      select: { toStatus: true, createdAt: true },
    });
    const delivery =
      order.fulfillmentMode === 'DELIVERY' &&
      order.deliveryAddressLine1 &&
      order.deliveryCity &&
      order.deliveryRegion &&
      order.deliveryPostalCode
        ? {
            addressLine1: order.deliveryAddressLine1,
            addressLine2: order.deliveryAddressLine2,
            neighborhood: order.deliveryNeighborhood,
            city: order.deliveryCity,
            region: order.deliveryRegion,
            postalCode: order.deliveryPostalCode,
          }
        : null;
    return {
      shop: scope.shop,
      numberLabel: formatOrderNumber(order.number),
      status: order.status,
      fulfillmentMode: order.fulfillmentMode,
      scheduledDate: formatDateParts(dateToParts(order.scheduledDate)) ?? '',
      windowStart:
        order.windowStartMinutes === null ? null : formatTimeOfDay(order.windowStartMinutes),
      windowEnd: order.windowEndMinutes === null ? null : formatTimeOfDay(order.windowEndMinutes),
      deliveryAddress: delivery,
      recipientName: order.recipientName,
      cardMessage: order.cardMessage,
      cardSignature: order.cardAnonymous ? null : order.cardSignature,
      cardAnonymous: order.cardAnonymous,
      currency: order.currency,
      lines: lines.map(toPublicLine),
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      totalMinor: order.totalMinor,
      paidMinor: order.paidMinor,
      balanceMinor:
        order.status === 'CANCELLED' ? 0 : orderBalanceMinor(order.paidMinor, order.totalMinor),
      history: events
        .filter((event) => event.toStatus !== 'DRAFT')
        .map((event) => ({ status: event.toStatus, at: event.createdAt })),
    };
  });
}

// -----------------------------------------------------------------------------
// Immagine del ramo di una riga
// -----------------------------------------------------------------------------

/** Foto vera o anteprima del ramo di una riga del documento del link; null se non c'è. */
export async function getPublicLineImage(
  secret: string,
  token: unknown,
  kind: PublicLinkKind,
  lineId: string,
): Promise<StoredImage | null> {
  if (!isUuid(lineId)) return null;
  const source = await withActiveLink(secret, token, kind, async (tx, scope) => {
    const select = {
      bouquetPhoto: { select: { storageKey: true, contentType: true } },
      previewJob: { select: { status: true, outputKey: true, outputContentType: true } },
    } as const;
    const line =
      kind === 'QUOTE' && scope.quoteId
        ? await tx.quoteLine.findFirst({
            where: { tenantId: scope.tenantId, quoteId: scope.quoteId, id: lineId },
            select,
          })
        : kind === 'ORDER' && scope.orderId
          ? await tx.orderLine.findFirst({
              where: { tenantId: scope.tenantId, orderId: scope.orderId, id: lineId },
              select,
            })
          : null;
    if (!line) return null;
    if (line.bouquetPhoto) {
      return { key: line.bouquetPhoto.storageKey, contentType: line.bouquetPhoto.contentType };
    }
    const job = line.previewJob;
    if (job?.status !== 'SUCCEEDED' || !job.outputKey) return null;
    return { key: job.outputKey, contentType: job.outputContentType ?? 'image/png' };
  });
  if (!source) return null;
  try {
    return await readStoredImage(
      source.key,
      source.contentType,
      kind === 'QUOTE' ? 'QuoteLine' : 'OrderLine',
    );
  } catch (error) {
    // File mancante nell'archivio (già registrato): per il cliente l'immagine semplicemente non c'è.
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
