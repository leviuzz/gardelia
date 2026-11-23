/**
 * Ordine del cliente dalla tienda en línea (marketplace, blocco C4, ADR-067).
 *
 * Chi compra ha un conto (sessione, `BuyerContext`) ma NON è membro della fioreria: lo slug diventa
 * una fioreria solo se la sua tienda è pubblicata (`app_public_store_tenant`), poi tutto avviene nel
 * contesto di quella fioreria con la RLS attiva (`withTenantContext` con l'utente di chi compra,
 * che rende leggibili anche i SUOI indirizzi salvati), mai con un contesto di sistema.
 *
 * Il modulo manda solo prodotti, quantità, consegna e tarjeta: prezzi, costo di consegna e totali li
 * decide il server dal catalogo e dalle impostazioni della fioreria. L'ordine nasce "Por aceptar"
 * (`PENDING_ACCEPTANCE`): lo accetta o lo rifiuta la fioreria (`services/orders.ts`), o si annulla
 * da solo se nessuno risponde (`expireUnacceptedOrders`).
 */
import { getDb, withTenantContext, withUserContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  EMPTY_PLACE,
  MARKETPLACE_DATE_ERRORS,
  MARKETPLACE_EXPIRED_REASON,
  MARKETPLACE_ORDER_LIMITS,
  addDays,
  deliveryAddressSchema,
  earliestMarketplaceDate,
  formatOrderNumber,
  formatTimeOfDay,
  isPendingOrderExpired,
  isUuid,
  isWeekday,
  marketplaceDateProblem,
  marketplaceLinesFromForm,
  marketplaceOrderSchema,
  nextStoredPlace,
  orderPaymentStatus,
  priceOrder,
  publicLinkExpiry,
  resolveLocale,
  toFieldErrors,
  toIsoDate,
  todayInTimeZone,
  type Availability,
  type CatalogItemType,
  type DeliveryAddressInput,
  type FulfillmentMode,
  type OrderStatus,
  type SaleUnit,
  type StorePaymentMethod,
  type StoredPlace,
  type SupportedLocale,
} from '@floral/domain';
import type { RequestMeta } from './context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { logger } from './logger';
import {
  buyerOrderMail,
  newOrderMailsForShop,
  sendOrderMails,
  type OrderMailDeps,
} from './order-mail';
import { createPublicLinkToken, publicLinkUrl } from './public-links';
import { onlineItemWhere, publishedTenantId } from './public-store';
import { addBuyerAddress, type BuyerAddressDto, type BuyerContext } from './services/buyer-account';
import { catalogLineDraft, lineRowData, type LineDraft } from './services/line-internals';
import {
  dateToParts,
  formatDateParts,
  nextTenantCounter,
  partsToDate,
} from './services/quote-internals';

// -----------------------------------------------------------------------------
// Modulo d'ordine
// -----------------------------------------------------------------------------

export interface CheckoutItemDto {
  readonly id: string;
  readonly type: CatalogItemType;
  readonly name: string;
  readonly priceMinor: number;
  readonly saleUnit: SaleUnit;
  readonly availability: Availability;
  readonly photoId: string | null;
}

export interface CheckoutFormDto {
  readonly store: {
    readonly slug: string;
    readonly name: string;
    readonly locale: SupportedLocale;
    readonly currency: string;
    readonly logoId: string | null;
    readonly isDemo: boolean;
    /** Dove si ritira (sede principale), o null. */
    readonly pickupAddress: string | null;
    readonly paymentMethods: readonly StorePaymentMethod[];
    readonly paymentInstructions: string | null;
  };
  readonly delivery: {
    /** Fasce proposte dalla fioreria ("HH:MM"); nessuna = in giornata. */
    readonly windows: readonly { readonly start: string; readonly end: string }[];
    readonly closedWeekdays: readonly number[];
    /** Costo di consegna della fioreria (0 = lo conferma la fioreria accettando). */
    readonly feeMinor: number;
    /** Primo e ultimo giorno che si possono scegliere ("AAAA-MM-GG"). */
    readonly minDate: string;
    readonly maxDate: string;
  };
  /** Prodotti visibili e non esauriti, in ordine di nome. */
  readonly items: readonly CheckoutItemDto[];
  readonly buyer: {
    readonly name: string;
    readonly email: string;
    readonly phone: string | null;
    readonly addresses: readonly BuyerAddressDto[];
  };
  /** Ordini di questa persona ancora da accettare in questa fioreria (limite: `pendingPerStore`). */
  readonly pendingCount: number;
}

function assertBuyer(buyer: BuyerContext): void {
  if (!isUuid(buyer.userId)) throw new TypeError('BuyerContext senza un utente valido');
}

/**
 * Tutto ciò che serve al modulo "Hacer pedido": prodotti ordinabili, regole di consegna e i dati di
 * chi compra. Null se la tienda non esiste, non è pubblicata o non riceve ordini online.
 */
export async function getCheckoutForm(
  buyer: BuyerContext,
  slug: unknown,
): Promise<CheckoutFormDto | null> {
  assertBuyer(buyer);
  const tenantId = await publishedTenantId(slug);
  if (!tenantId) return null;
  return withTenantContext(getDb(), { tenantId, userId: buyer.userId }, async (tx) => {
    const store = await tx.onlineStore.findUnique({ where: { tenantId } });
    if (!store?.ordersEnabled) return null;
    const [tenant, location, windows, items, user, profile, addresses, pendingCount] =
      await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: {
            slug: true,
            displayName: true,
            defaultLocale: true,
            currency: true,
            mode: true,
            timezone: true,
            deliveryClosedWeekdays: true,
            defaultDeliveryFeeMinor: true,
          },
        }),
        tx.location.findFirst({
          where: { tenantId, isPrimary: true },
          select: { addressLine1: true, neighborhood: true, city: true },
        }),
        tx.deliveryWindow.findMany({
          where: { tenantId },
          orderBy: [{ startMinutes: 'asc' }, { endMinutes: 'asc' }],
          select: { startMinutes: true, endMinutes: true },
        }),
        tx.catalogItem.findMany({
          where: { ...onlineItemWhere(tenantId), availability: { not: 'OUT_OF_STOCK' } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 120,
          select: {
            id: true,
            type: true,
            name: true,
            priceMinor: true,
            saleUnit: true,
            availability: true,
            photos: {
              where: { status: 'ACTIVE' },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              take: 1,
              select: { id: true },
            },
          },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: buyer.userId },
          select: { name: true, email: true },
        }),
        tx.buyerProfile.findUnique({ where: { userId: buyer.userId }, select: { phone: true } }),
        tx.buyerAddress.findMany({
          where: { userId: buyer.userId, status: 'ACTIVE' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            label: true,
            recipientName: true,
            recipientPhone: true,
            addressLine1: true,
            addressLine2: true,
            neighborhood: true,
            city: true,
            region: true,
            postalCode: true,
            deliveryNotes: true,
            isDefault: true,
            placeId: true,
          },
        }),
        tx.order.count({
          where: { tenantId, buyerUserId: buyer.userId, status: 'PENDING_ACCEPTANCE' },
        }),
      ]);
    const today = todayInTimeZone(tenant.timezone);
    return {
      store: {
        slug: tenant.slug,
        name: tenant.displayName,
        locale: resolveLocale(tenant.defaultLocale),
        currency: tenant.currency,
        logoId: store.logoId,
        isDemo: tenant.mode === 'DEMO',
        pickupAddress: location
          ? [location.addressLine1, location.neighborhood, location.city].filter(Boolean).join(', ')
          : null,
        paymentMethods: store.paymentMethods as StorePaymentMethod[],
        paymentInstructions: store.paymentInstructions,
      },
      delivery: {
        windows: windows.map((window) => ({
          start: formatTimeOfDay(window.startMinutes),
          end: formatTimeOfDay(window.endMinutes),
        })),
        closedWeekdays: tenant.deliveryClosedWeekdays.filter(isWeekday),
        feeMinor: tenant.defaultDeliveryFeeMinor,
        minDate: toIsoDate(earliestMarketplaceDate(today, store.minLeadDays)),
        maxDate: toIsoDate(addDays(today, MARKETPLACE_ORDER_LIMITS.scheduleDaysMax)),
      },
      items: items.map(({ photos, ...item }) => ({ ...item, photoId: photos[0]?.id ?? null })),
      buyer: { name: user.name, email: user.email, phone: profile?.phone ?? null, addresses },
      pendingCount,
    };
  });
}

// -----------------------------------------------------------------------------
// Invio dell'ordine
// -----------------------------------------------------------------------------

export interface PlaceOrderOptions {
  /** Chi compra è arrivato dalla ricerca di Gardelia (origine MARKETPLACE_B2C, fee D-24). */
  readonly fromSearch: boolean;
  readonly request?: RequestMeta;
}

export interface PlacedOrderDto {
  readonly orderId: string;
  readonly numberLabel: string;
  /** Percorso della pagina di tracciamento (`/pedido/<token>`). */
  readonly trackingPath: string;
}

function placeFields(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Righe pronte, con i prezzi del catalogo; un prodotto non più ordinabile ferma tutto. */
async function draftLines(
  tx: TransactionClient,
  tenantId: string,
  lines: readonly { readonly itemId: string; readonly quantity: number }[],
): Promise<{ draft: LineDraft; quantity: number }[]> {
  const ids = lines.map((line) => line.itemId);
  const orderable = await tx.catalogItem.findMany({
    where: { ...onlineItemWhere(tenantId), id: { in: ids }, availability: { not: 'OUT_OF_STOCK' } },
    select: { id: true },
  });
  const allowed = new Set(orderable.map((item) => item.id));
  if (ids.some((id) => !allowed.has(id))) {
    throw new ValidationError({ lines: 'item_unavailable' });
  }
  const result: { draft: LineDraft; quantity: number }[] = [];
  for (const line of lines) {
    try {
      result.push({
        draft: await catalogLineDraft(tx, { tenantId }, line.itemId),
        quantity: line.quantity,
      });
    } catch (error) {
      if (error instanceof ValidationError)
        throw new ValidationError({ lines: 'item_unavailable' });
      throw error;
    }
  }
  return result;
}

/**
 * "Enviar pedido". L'ordine entra nella fioreria "Por aceptar", con il cliente collegato al CRM
 * (stessa email) o creato; chi compra e la fioreria ricevono un'email.
 */
export async function placeMarketplaceOrder(
  buyer: BuyerContext,
  slug: unknown,
  rawInput: unknown,
  options: PlaceOrderOptions,
  deps: OrderMailDeps,
): Promise<PlacedOrderDto> {
  assertBuyer(buyer);
  const raw = placeFields(rawInput);
  const parsed = marketplaceOrderSchema(buyer.country).safeParse({
    ...raw,
    lines: marketplaceLinesFromForm(raw),
  });
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const ids = input.lines.map((line) => line.itemId);
  if (new Set(ids).size !== ids.length) throw new ValidationError({ lines: 'invalid_option' });

  // Un indirizzo nuovo segue le regole della rubrica (lo si valida prima di toccare il database).
  let newAddress: DeliveryAddressInput | null = null;
  if (input.fulfillmentMode === 'DELIVERY' && !input.buyerAddressId) {
    const address = deliveryAddressSchema(buyer.country).safeParse(raw);
    if (!address.success) throw new ValidationError(toFieldErrors(address.error));
    newAddress = address.data;
  }

  const tenantId = await publishedTenantId(slug);
  if (!tenantId) throw new NotFoundError('OnlineStore');

  const placed = await withTenantContext(
    getDb(),
    { tenantId, userId: buyer.userId },
    async (tx) => {
      // Una richiesta alla volta per persona e fioreria: il limite degli ordini in attesa regge
      // anche a due invii contemporanei.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${tenantId}:${buyer.userId}`}))`;
      const [store, tenant, user] = await Promise.all([
        tx.onlineStore.findUnique({ where: { tenantId } }),
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: {
            timezone: true,
            currency: true,
            deliveryClosedWeekdays: true,
            defaultDeliveryFeeMinor: true,
          },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: buyer.userId },
          select: { name: true, email: true },
        }),
      ]);
      if (!store?.ordersEnabled) throw new ConflictError('checkout_closed');
      const pending = await tx.order.count({
        where: { tenantId, buyerUserId: buyer.userId, status: 'PENDING_ACCEPTANCE' },
      });
      if (pending >= MARKETPLACE_ORDER_LIMITS.pendingPerStore) {
        throw new ConflictError('checkout_pending_limit');
      }

      const problem = marketplaceDateProblem(input.scheduledDate, {
        today: todayInTimeZone(tenant.timezone),
        minLeadDays: store.minLeadDays,
        closedWeekdays: tenant.deliveryClosedWeekdays,
      });
      if (problem) throw new ValidationError({ scheduledDate: MARKETPLACE_DATE_ERRORS[problem] });

      // Una fascia scelta deve essere una di quelle della fioreria; vuota = in giornata.
      if (input.window) {
        const window = await tx.deliveryWindow.findFirst({
          where: { tenantId, startMinutes: input.window.start, endMinutes: input.window.end },
          select: { id: true },
        });
        if (!window) throw new ValidationError({ window: 'invalid_option' });
      }

      const lines = await draftLines(tx, tenantId, input.lines);
      const subtotalMinor = lines.reduce(
        (sum, line) => sum + line.quantity * line.draft.unitPriceMinor,
        0,
      );

      // Indirizzo di consegna COPIATO nell'ordine: da "Mi cuenta" o nuovo.
      let address: {
        addressLine1: string;
        addressLine2: string | null;
        neighborhood: string | null;
        city: string;
        region: string;
        postalCode: string;
      } | null = null;
      let place: StoredPlace = EMPTY_PLACE;
      let recipientName = input.recipientName;
      let recipientPhone = input.recipientPhone;
      let deliveryNotes = input.deliveryNotes;
      if (input.fulfillmentMode === 'DELIVERY') {
        if (input.buyerAddressId) {
          const saved = await tx.buyerAddress.findFirst({
            where: { id: input.buyerAddressId, userId: buyer.userId, status: 'ACTIVE' },
          });
          if (!saved) throw new ValidationError({ buyerAddressId: 'invalid_option' });
          address = saved;
          place = {
            placeId: saved.placeId,
            latitude: saved.latitude,
            longitude: saved.longitude,
            coordinatesAt: saved.coordinatesAt,
          };
          recipientName ??= saved.recipientName;
          recipientPhone ??= saved.recipientPhone;
          deliveryNotes ??= saved.deliveryNotes;
        } else if (newAddress) {
          address = newAddress;
          place = nextStoredPlace(raw, null, new Date());
        }
      }

      const totals = priceOrder({
        subtotalMinor,
        discountMinor: 0,
        deliveryFeeMinor: input.fulfillmentMode === 'DELIVERY' ? tenant.defaultDeliveryFeeMinor : 0,
      });
      if (!totals.ok) throw new ValidationError({ lines: totals.error });

      // Cliente del CRM della fioreria: quello con la stessa email, o uno nuovo.
      const acquisitionSource = options.fromSearch ? 'MARKETPLACE_B2C' : 'MERCHANT_DIRECT';
      const existing = await tx.customer.findFirst({
        where: { tenantId, status: 'ACTIVE', email: { equals: user.email, mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const customer =
        existing ??
        (await tx.customer.create({
          data: {
            tenantId,
            type: 'PERSON',
            displayName: user.name,
            email: user.email.toLowerCase(),
            phone: input.contactPhone,
            acquisitionSource,
            acquisitionChannel: 'online_store',
          },
          select: { id: true },
        }));

      const number = await nextTenantCounter(tx, tenantId, 'order');
      const order = await tx.order.create({
        data: {
          tenantId,
          number,
          customerId: customer.id,
          status: 'PENDING_ACCEPTANCE',
          currency: tenant.currency,
          fulfillmentMode: input.fulfillmentMode,
          scheduledDate: partsToDate(input.scheduledDate),
          windowStartMinutes: input.window?.start ?? null,
          windowEndMinutes: input.window?.end ?? null,
          deliveryAddressLine1: address?.addressLine1 ?? null,
          deliveryAddressLine2: address?.addressLine2 ?? null,
          deliveryNeighborhood: address?.neighborhood ?? null,
          deliveryCity: address?.city ?? null,
          deliveryRegion: address?.region ?? null,
          deliveryPostalCode: address?.postalCode ?? null,
          deliveryCountryCode: address ? buyer.country : null,
          deliveryPlaceId: place.placeId,
          deliveryLatitude: place.latitude,
          deliveryLongitude: place.longitude,
          deliveryCoordinatesAt: place.coordinatesAt,
          deliveryNotes: input.fulfillmentMode === 'DELIVERY' ? deliveryNotes : null,
          recipientName,
          recipientPhone,
          cardMessage: input.cardMessage,
          cardSignature: input.cardAnonymous ? null : input.cardSignature,
          cardAnonymous: input.cardAnonymous,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          deliveryFeeMinor: totals.deliveryFeeMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          paidMinor: 0,
          paymentStatus: orderPaymentStatus(0, totals.totalMinor),
          acquisitionSource,
          placedOnline: true,
          buyerUserId: buyer.userId,
          buyerNotes: input.buyerNotes,
        },
      });
      await tx.orderLine.createMany({
        data: lines.map((line, index) => ({
          tenantId,
          orderId: order.id,
          ...lineRowData(line.draft, line.quantity, index),
        })),
      });
      await tx.orderStatusEvent.create({
        data: { tenantId, orderId: order.id, fromStatus: null, toStatus: 'PENDING_ACCEPTANCE' },
      });
      const now = new Date();
      const link = await tx.publicLink.create({
        data: {
          tenantId,
          kind: 'ORDER',
          orderId: order.id,
          createdAt: now,
          expiresAt: publicLinkExpiry(now),
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: buyer.userId,
          action: AUDIT_ACTIONS.orderPlacedOnline,
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            number: formatOrderNumber(number),
            mode: input.fulfillmentMode,
            source: acquisitionSource,
            newCustomer: existing === null,
          },
          requestId: options.request?.requestId ?? null,
          ipAddress: options.request?.ipAddress ?? null,
        },
      });
      // Il telefono di chi compra resta nel suo profilo per la prossima volta.
      await tx.$executeRaw`INSERT INTO "BuyerProfile" ("userId", "phone", "updatedAt")
      VALUES (${buyer.userId}::uuid, ${input.contactPhone}, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId") DO UPDATE SET "phone" = EXCLUDED."phone", "updatedAt" = CURRENT_TIMESTAMP`;

      const mails = [
        await buyerOrderMail(tx, tenantId, order.id, 'received', deps),
        ...(await newOrderMailsForShop(
          tx,
          tenantId,
          order.id,
          { buyerName: user.name, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0) },
          deps,
        )),
      ].filter((mail) => mail !== null);
      return {
        result: {
          orderId: order.id,
          numberLabel: formatOrderNumber(number),
          trackingPath: publicLinkUrl(
            '',
            'ORDER',
            createPublicLinkToken(deps.secret, { tenantId, linkId: link.id }),
          ),
        },
        mails,
      };
    },
  );

  logger.info({ tenantId, orderId: placed.result.orderId }, 'ordine online ricevuto');
  await sendOrderMails(deps.mailer, placed.mails);

  // "Guardar esta dirección": dopo l'ordine, senza mai farlo fallire (es. rubrica piena).
  if (newAddress && input.saveAddress) {
    try {
      await addBuyerAddress(buyer, raw);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        logger.warn({ err: error }, "indirizzo dell'ordine online non salvato");
      }
    }
  }
  return placed.result;
}

// -----------------------------------------------------------------------------
// "Mis pedidos"
// -----------------------------------------------------------------------------

export interface BuyerOrderDto {
  readonly orderId: string;
  readonly shopSlug: string;
  readonly shopName: string;
  readonly numberLabel: string;
  readonly status: OrderStatus;
  readonly fulfillmentMode: FulfillmentMode;
  /** "AAAA-MM-GG". */
  readonly scheduledDate: string | null;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
  /** Pagina di tracciamento (`/pedido/<token>`), se il link è ancora attivo. */
  readonly trackingPath: string | null;
}

/**
 * Gli ordini online di chi ha fatto l'accesso, in tutte le fiorerie (al massimo 100, i più recenti
 * per primi). La funzione SQL legge l'utente SOLO dal contesto: nessuno vede gli ordini di altri.
 */
export async function listBuyerOrders(
  buyer: BuyerContext,
  secret: string,
): Promise<readonly BuyerOrderDto[]> {
  assertBuyer(buyer);
  const rows = await withUserContext(
    getDb(),
    buyer.userId,
    (tx) =>
      tx.$queryRaw<
        {
          order_id: string;
          tenant_id: string;
          shop_slug: string;
          shop_name: string;
          number: number;
          status: OrderStatus;
          fulfillment_mode: FulfillmentMode;
          scheduled_date: Date | null;
          total_minor: number;
          currency: string;
          created_at: Date;
          link_id: string | null;
        }[]
      >`SELECT * FROM app_buyer_orders()`,
  );
  return rows.map((row) => ({
    orderId: row.order_id,
    shopSlug: row.shop_slug,
    shopName: row.shop_name,
    numberLabel: formatOrderNumber(row.number),
    status: row.status,
    fulfillmentMode: row.fulfillment_mode,
    scheduledDate: row.scheduled_date ? formatDateParts(dateToParts(row.scheduled_date)) : null,
    totalMinor: row.total_minor,
    currency: row.currency.trim(),
    createdAt: row.created_at,
    trackingPath: row.link_id
      ? publicLinkUrl(
          '',
          'ORDER',
          createPublicLinkToken(secret, { tenantId: row.tenant_id, linkId: row.link_id }),
        )
      : null,
  }));
}

// -----------------------------------------------------------------------------
// Ordini mai accettati (manutenzione giornaliera)
// -----------------------------------------------------------------------------

/** Quanti ordini scaduti si annullano in un giro (il resto al giro dopo). */
const EXPIRE_BATCH = 200;

/**
 * Annulla gli ordini online rimasti "Por aceptar" troppo a lungo o col giorno già passato, e lo
 * scrive a chi compra. La funzione SQL sceglie solo gli ID; ogni annullamento avviene nel contesto
 * della sua fioreria, ricontrollando stato e condizioni sotto lock. Idempotente.
 */
export async function expireUnacceptedOrders(deps: OrderMailDeps | null): Promise<number> {
  const candidates = await getDb().$queryRaw<{ tenant_id: string; order_id: string }[]>`
    SELECT tenant_id, order_id
    FROM app_pending_orders_to_expire(${MARKETPLACE_ORDER_LIMITS.acceptDays}::int, ${EXPIRE_BATCH}::int)`;
  let expired = 0;
  for (const candidate of candidates) {
    try {
      const mail = await withTenantContext(
        getDb(),
        { tenantId: candidate.tenant_id, userId: null },
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.order_id}::uuid
            AND "tenantId" = ${candidate.tenant_id}::uuid FOR UPDATE`;
          const [order, tenant] = await Promise.all([
            tx.order.findFirst({
              where: { tenantId: candidate.tenant_id, id: candidate.order_id },
            }),
            tx.tenant.findUniqueOrThrow({
              where: { id: candidate.tenant_id },
              select: { timezone: true },
            }),
          ]);
          if (!order || order.status !== 'PENDING_ACCEPTANCE') return { done: false, mail: null };
          const today = todayInTimeZone(tenant.timezone);
          const scheduledDate = order.scheduledDate ? dateToParts(order.scheduledDate) : null;
          if (
            !isPendingOrderExpired({ createdAt: order.createdAt, scheduledDate }, new Date(), today)
          ) {
            return { done: false, mail: null };
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'CANCELLED',
              statusChangedAt: new Date(),
              cancelReason: MARKETPLACE_EXPIRED_REASON,
            },
          });
          await tx.orderStatusEvent.create({
            data: {
              tenantId: order.tenantId,
              orderId: order.id,
              fromStatus: order.status,
              toStatus: 'CANCELLED',
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: order.tenantId,
              actorUserId: null,
              action: AUDIT_ACTIONS.orderExpired,
              entityType: 'Order',
              entityId: order.id,
              metadata: { number: formatOrderNumber(order.number) },
            },
          });
          return {
            done: true,
            mail: deps ? await buyerOrderMail(tx, order.tenantId, order.id, 'expired', deps) : null,
          };
        },
      );
      if (mail.done) expired += 1;
      if (deps && mail.mail) await sendOrderMails(deps.mailer, [mail.mail]);
    } catch (error) {
      logger.error({ err: error, orderId: candidate.order_id }, 'ordine online non annullato');
    }
  }
  return expired;
}
