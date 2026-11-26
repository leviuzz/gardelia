/**
 * Marketplace M3-1 (ADR-088) — l'ordine online visto e usato da chi l'ha fatto, dal suo conto:
 * la pagina dell'ordine, i messaggi con la fioreria, il segno di lettura, «Pedir de nuevo», le foto.
 *
 * Tutto passa da `withBuyerOrder`: la fioreria la dà `app_buyer_order_shop` (solo per gli ordini
 * della persona, utente dal contesto); poi, nel contesto della fioreria con la guardia
 * `app.buyer_order_id` (le tabelle dell'ordine danno e accettano solo le righe di quell'ordine), si
 * ricontrolla che l'ordine sia della persona e che la fioreria sia attiva. Un ordine di un altro
 * risponde 404 come uno inesistente, senza sonda fra fiorerie (la persona non è un membro).
 */
import { getDb, withBuyerOrderContext, withUserContext, type TransactionClient } from '@floral/db';
import {
  ORDER_MESSAGE_LIMITS,
  formatOrderNumber,
  isOrderClosed,
  isUuid,
  newId,
  orderMessageDayStart,
  orderMessagePages,
  orderMessageProblem,
  orderMessageSchema,
  orderMessagesOpen,
  diffOrderChanges,
  parseOrderChangeSnapshot,
  pendingOrderDeadline,
  toFieldErrors,
  type OrderChangeDiff,
  type OrderChangeStatus,
  type OrderStatus,
} from '@floral/domain';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { logger } from './logger';
import { deleteUnusedFiles, storeFilesThenCommit, type StoredImage } from './media/stored-files';
import {
  claimMessageNoticeTx,
  orderMessageSelect,
  prepareOrderMessagePhoto,
  toOrderMessageDto,
  type OrderMessageDto,
} from './order-message-internals';
import { sendOrderMails, shopMessageNoticeMails, type OrderMailDeps } from './order-mail';
import {
  createPublicLinkToken,
  publicLinkUrl,
  readCustomerOrderTx,
  readOrderLineImageSourceTx,
  readPublicShopTx,
  readStoredImageOrNull,
  type PublicOrderDto,
  type PublicShopDto,
} from './public-links';
import type { BuyerContext } from './services/buyer-account';
import { dateToParts } from './services/quote-internals';

function assertBuyer(buyer: BuyerContext): void {
  if (!isUuid(buyer.userId)) throw new TypeError('BuyerContext senza un utente valido');
}

/** La fioreria dell'ordine, come la vede chi l'ha fatto. */
export interface BuyerOrderShop {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

interface BuyerOrderRow {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly statusChangedAt: Date;
  readonly placedOnline: boolean;
  readonly buyerUserId: string | null;
  readonly createdAt: Date;
  readonly scheduledDate: Date | null;
}

export interface BuyerOrderScope {
  readonly shop: BuyerOrderShop;
  readonly order: BuyerOrderRow;
}

const buyerOrderSelect = {
  id: true,
  number: true,
  status: true,
  statusChangedAt: true,
  placedOnline: true,
  buyerUserId: true,
  createdAt: true,
  scheduledDate: true,
} as const;

/**
 * Il solo ingresso di chi compra a un suo ordine (M3, ADR-088): trova la fioreria, apre il suo
 * contesto con la guardia sull'ordine, blocca l'ordine se serve (`lock`: chi scrive aspetta chi
 * scrive) e ricontrolla proprietario e fioreria attiva. NotFoundError in ogni altro caso.
 */
export async function withBuyerOrder<T>(
  buyer: BuyerContext,
  orderId: string,
  fn: (tx: TransactionClient, scope: BuyerOrderScope) => Promise<T>,
  options: { readonly lock?: boolean } = {},
): Promise<T> {
  assertBuyer(buyer);
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const rows = await withUserContext(
    getDb(),
    buyer.userId,
    (tx) =>
      tx.$queryRaw<
        { tenant_id: string; shop_slug: string; shop_name: string; shop_active: boolean }[]
      >`SELECT * FROM app_buyer_order_shop(${orderId}::uuid)`,
  );
  const found = rows[0];
  // Una fioreria in eliminazione (ADR-074) sparisce anche da qui.
  if (!found || !found.shop_active) throw new NotFoundError('Order');
  const shop = { tenantId: found.tenant_id, slug: found.shop_slug, name: found.shop_name };
  return withBuyerOrderContext(
    getDb(),
    { tenantId: shop.tenantId, userId: buyer.userId, orderId },
    async (tx) => {
      if (options.lock) {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid
          AND "tenantId" = ${shop.tenantId}::uuid FOR UPDATE`;
      }
      const order = await tx.order.findFirst({
        where: { tenantId: shop.tenantId, id: orderId },
        select: buyerOrderSelect,
      });
      if (!order || !order.placedOnline || order.buyerUserId !== buyer.userId) {
        throw new NotFoundError('Order');
      }
      return fn(tx, { shop, order });
    },
  );
}

// -----------------------------------------------------------------------------
// La pagina dell'ordine
// -----------------------------------------------------------------------------

export interface BuyerOrderThreadDto {
  /** Si scrive fino a 7 giorni dopo la consegna, il ritiro o l'annullamento. */
  readonly open: boolean;
  /** Dal più vecchio al più recente (gli ultimi `pages` × 30). */
  readonly messages: readonly OrderMessageDto[];
  readonly hasOlder: boolean;
  /** Messaggi della fioreria arrivati dopo l'ultima lettura. */
  readonly unreadCount: number;
}

/**
 * I cambi della fioreria come li vede chi compra (M3-2): `ASKED` da confermare (con prima e dopo),
 * `EDITING` la fioreria lo sta rivedendo, `DECLINED` hai detto «No, gracias».
 */
export interface BuyerOrderChangeDto {
  readonly status: OrderChangeStatus;
  /** La richiesta da confermare: la risposta porta questo numero. */
  readonly round: number;
  /** Com'era → come lo propone la fioreria (solo `ASKED`). */
  readonly diff: OrderChangeDiff | null;
  /** Il messaggio della fioreria con la richiesta (solo `ASKED`). */
  readonly message: string | null;
  readonly askedAt: Date | null;
}

export interface BuyerOrderDetailDto {
  readonly orderId: string;
  readonly shop: BuyerOrderShop & PublicShopDto;
  /** L'ordine come nel link di stato (stessa lettura). */
  readonly order: PublicOrderDto;
  readonly thread: BuyerOrderThreadDto;
  /** «Annulla l'ordine» finché la fioreria non l'ha accettato. */
  readonly canCancel: boolean;
  /** «Pedir de nuevo»: ordine chiuso, prodotti del catalogo e negozio che prende ordini online. */
  readonly canReorder: boolean;
  /** Fino a quando la fioreria lo può accettare (solo da accettare). */
  readonly deadline: Date | null;
  /** I cambi della fioreria su un ordine ancora da accettare (M3-2); null senza. */
  readonly change: BuyerOrderChangeDto | null;
  /** Il link di stato da condividere, se attivo (`/pedido/<token>`). */
  readonly trackingPath: string | null;
}

/** La pagina dell'ordine nel conto di chi l'ha fatto (lettura: non segna niente come letto). */
export async function getBuyerOrder(
  buyer: BuyerContext,
  orderId: string,
  options: { readonly secret: string; readonly pages?: number },
): Promise<BuyerOrderDetailDto> {
  const take = ORDER_MESSAGE_LIMITS.page * orderMessagePages(options.pages ?? 1);
  return withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    const publicShop = await readPublicShopTx(tx, shop.tenantId);
    const detail = publicShop
      ? await readCustomerOrderTx(tx, shop.tenantId, order.id, publicShop)
      : null;
    if (!publicShop || !detail) throw new NotFoundError('Order');
    const [read, rows, link, store, catalogLines, change] = await Promise.all([
      tx.orderBuyerRead.findUnique({
        where: {
          tenantId_orderId_userId: {
            tenantId: shop.tenantId,
            orderId: order.id,
            userId: buyer.userId,
          },
        },
        select: { readAt: true },
      }),
      tx.orderMessage.findMany({
        where: { tenantId: shop.tenantId, orderId: order.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        select: orderMessageSelect,
      }),
      tx.publicLink.findFirst({
        where: {
          tenantId: shop.tenantId,
          orderId: order.id,
          kind: 'ORDER',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
      tx.onlineStore.findUnique({
        where: { tenantId: shop.tenantId },
        select: { publishedAt: true, ordersEnabled: true },
      }),
      tx.orderLine.count({
        where: { tenantId: shop.tenantId, orderId: order.id, catalogItemId: { not: null } },
      }),
      tx.orderChangeRequest.findUnique({
        where: { tenantId_orderId: { tenantId: shop.tenantId, orderId: order.id } },
      }),
    ]);
    const pending = order.status === 'PENDING_ACCEPTANCE';
    const asked = pending && change?.status === 'ASKED';
    const before = asked ? parseOrderChangeSnapshot(change.before) : null;
    const after = asked && change.after !== null ? parseOrderChangeSnapshot(change.after) : null;
    const readAt = read?.readAt ?? null;
    const messages = rows
      .slice(0, take)
      .reverse()
      .map((row) => toOrderMessageDto(row, 'BUYER', readAt));
    const unreadCount = await tx.orderMessage.count({
      where: {
        tenantId: shop.tenantId,
        orderId: order.id,
        authorKind: 'SHOP',
        ...(readAt ? { createdAt: { gt: readAt } } : {}),
      },
    });
    const storeOpen = Boolean(store?.publishedAt && store.ordersEnabled);
    return {
      orderId: order.id,
      shop: { ...shop, ...publicShop },
      order: detail,
      thread: {
        open: orderMessagesOpen(order),
        messages,
        hasOlder: rows.length > take,
        unreadCount,
      },
      canCancel: order.status === 'PENDING_ACCEPTANCE',
      canReorder: isOrderClosed(order.status) && storeOpen && catalogLines > 0,
      deadline: pending
        ? pendingOrderDeadline(
            {
              createdAt: order.createdAt,
              scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
              changeAskedAt: change?.askedAt ?? null,
              changeAnsweredAt: change?.answeredAt ?? null,
            },
            publicShop.timezone,
          )
        : null,
      change:
        pending && change
          ? {
              status: change.status as OrderChangeStatus,
              round: change.round,
              diff: before && after ? diffOrderChanges(before, after) : null,
              message: asked ? change.message : null,
              askedAt: change.askedAt,
            }
          : null,
      trackingPath: link
        ? publicLinkUrl(
            '',
            'ORDER',
            createPublicLinkToken(options.secret, { tenantId: shop.tenantId, linkId: link.id }),
          )
        : null,
    };
  });
}

// -----------------------------------------------------------------------------
// Messaggi
// -----------------------------------------------------------------------------

export interface BuyerOrderMessagePostResult {
  readonly id: string;
  readonly duplicate: boolean;
  /** È partito l'avviso per email a proprietari e gerenti. */
  readonly notified: boolean;
}

/** Quanti messaggi ha scritto oggi la persona su questo ordine (nel fuso della fioreria). */
async function todayCountTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  userId: string,
): Promise<number> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return tx.orderMessage.count({
    where: {
      tenantId,
      orderId,
      authorKind: 'BUYER',
      authorUserId: userId,
      createdAt: { gte: orderMessageDayStart(tenant.timezone) },
    },
  });
}

/**
 * Chi ha fatto l'ordine scrive alla fioreria (testo e/o una foto). Proprietari e gerenti ricevono
 * l'avviso al primo messaggio da leggere (o di nuovo dopo 6 ore), dopo il commit.
 */
export async function postBuyerOrderMessage(
  buyer: BuyerContext,
  orderId: string,
  rawInput: unknown,
  photo: Uint8Array | null,
  deps: OrderMailDeps | null,
): Promise<BuyerOrderMessagePostResult> {
  assertBuyer(buyer);
  const parsed = orderMessageSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const hasPhoto = photo !== null && photo.byteLength > 0;

  // Prima un controllo veloce, così un messaggio rifiutato non elabora né carica la foto.
  const precheck = await withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    const existing = await tx.orderMessage.findFirst({
      where: { tenantId: shop.tenantId, orderId: order.id, submitKey: input.submitKey },
      select: { id: true },
    });
    if (existing) return { shop, duplicate: existing.id };
    const problem = orderMessageProblem({ order, body: input.body, hasPhoto });
    if (problem === 'order_message_closed') throw new ConflictError(problem);
    if (problem === 'order_message_empty') throw new ValidationError({ body: problem });
    if (
      (await todayCountTx(tx, shop.tenantId, order.id, buyer.userId)) >=
      ORDER_MESSAGE_LIMITS.perBuyerPerDay
    ) {
      throw new ConflictError('order_message_daily_limit');
    }
    return { shop, duplicate: null };
  });
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true, notified: false };

  const prepared = hasPhoto
    ? await prepareOrderMessagePhoto(precheck.shop.tenantId, orderId, photo)
    : null;
  const id = newId();
  const commit = () =>
    withBuyerOrder(
      buyer,
      orderId,
      async (tx, { shop, order }) => {
        if (!orderMessagesOpen(order)) throw new ConflictError('order_message_closed');
        if (
          (await todayCountTx(tx, shop.tenantId, order.id, buyer.userId)) >=
          ORDER_MESSAGE_LIMITS.perBuyerPerDay
        ) {
          throw new ConflictError('order_message_daily_limit');
        }
        const created = await tx.orderMessage.createManyAndReturn({
          data: [
            {
              id,
              tenantId: shop.tenantId,
              orderId: order.id,
              authorKind: 'BUYER',
              authorUserId: buyer.userId,
              body: input.body,
              ...(prepared?.row ?? {}),
              submitKey: input.submitKey,
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        if (created.length === 0) {
          const existing = await tx.orderMessage.findFirst({
            where: { tenantId: shop.tenantId, orderId: order.id, submitKey: input.submitKey },
            select: { id: true },
          });
          return { id: existing?.id ?? id, duplicate: true, mails: [] };
        }
        const notify = await claimMessageNoticeTx(tx, {
          tenantId: shop.tenantId,
          orderId: order.id,
          buyerUserId: buyer.userId,
          to: 'SHOP',
          messageId: id,
        });
        const mails =
          notify && deps ? await shopMessageNoticeMails(tx, shop.tenantId, order.id, deps) : [];
        return { id, duplicate: false, mails };
      },
      { lock: true },
    );
  const saved = prepared ? await storeFilesThenCommit(prepared.files, commit) : await commit();
  if (!saved) throw new NotFoundError('Order');
  if (saved.duplicate && prepared) {
    await deleteUnusedFiles(prepared.files.map((file) => file.key));
  }
  if (deps && saved.mails.length > 0) await sendOrderMails(deps.mailer, saved.mails);
  logger.info({ tenantId: precheck.shop.tenantId, orderId }, 'messaggio di chi compra');
  return { id: saved.id, duplicate: saved.duplicate, notified: saved.mails.length > 0 };
}

/** Chi ha fatto l'ordine ha letto i messaggi della fioreria (fin qui). */
export async function markBuyerOrderRead(buyer: BuyerContext, orderId: string): Promise<void> {
  await withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    const now = new Date();
    await tx.orderBuyerRead.upsert({
      where: {
        tenantId_orderId_userId: {
          tenantId: shop.tenantId,
          orderId: order.id,
          userId: buyer.userId,
        },
      },
      create: { tenantId: shop.tenantId, orderId: order.id, userId: buyer.userId, readAt: now },
      update: { readAt: now },
    });
  });
}

// -----------------------------------------------------------------------------
// «Pedir de nuevo»
// -----------------------------------------------------------------------------

export interface BuyerReorderDto {
  readonly shopSlug: string;
  /** I prodotti del catalogo dell'ordine, con la quantità: il carrello li ricontrolla tutti. */
  readonly lines: readonly { readonly itemId: string; readonly quantity: number }[];
  /** Righe che non si ripetono online (composizioni del Designer, voci libere). */
  readonly skipped: number;
}

/**
 * I prodotti di un ordine chiuso da rimettere nel carrello. Il web li aggiunge al cookie della
 * fioreria; il modulo d'ordine toglie, con l'avviso di sempre, quelli non più ordinabili.
 */
export async function buyerReorderLines(
  buyer: BuyerContext,
  orderId: string,
): Promise<BuyerReorderDto> {
  return withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    if (!isOrderClosed(order.status)) throw new ConflictError('order_not_reorderable');
    const store = await tx.onlineStore.findUnique({
      where: { tenantId: shop.tenantId },
      select: { publishedAt: true, ordersEnabled: true },
    });
    if (!store?.publishedAt || !store.ordersEnabled) {
      throw new ConflictError('order_not_reorderable');
    }
    const lines = await tx.orderLine.findMany({
      where: { tenantId: shop.tenantId, orderId: order.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { kind: true, catalogItemId: true, quantity: true },
    });
    const catalog = lines.filter(
      (line): line is typeof line & { catalogItemId: string } =>
        line.kind === 'CATALOG_ITEM' && line.catalogItemId !== null,
    );
    return {
      shopSlug: shop.slug,
      lines: catalog.map((line) => ({ itemId: line.catalogItemId, quantity: line.quantity })),
      skipped: lines.length - catalog.length,
    };
  });
}

// -----------------------------------------------------------------------------
// Immagini della pagina dell'ordine (rotte del conto: non dipendono dal link di stato)
// -----------------------------------------------------------------------------

/** La foto di un messaggio dell'ordine (`thumb` = miniatura), finché si vede. */
export async function getBuyerOrderMessagePhoto(
  buyer: BuyerContext,
  orderId: string,
  messageId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage | null> {
  if (!isUuid(messageId)) return null;
  const message = await withBuyerOrder(buyer, orderId, (tx, { shop, order }) =>
    tx.orderMessage.findFirst({
      where: {
        tenantId: shop.tenantId,
        orderId: order.id,
        id: messageId,
        photoKey: { not: null },
        photoRemovedAt: null,
        photoDeletedAt: null,
      },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!message?.photoKey) return null;
  const key = variant === 'thumb' ? (message.photoThumbKey ?? message.photoKey) : message.photoKey;
  return readStoredImageOrNull(key, 'image/jpeg', 'OrderMessage');
}

/** L'immagine del ramo di una riga dell'ordine; null se non c'è. */
export async function getBuyerOrderLineImage(
  buyer: BuyerContext,
  orderId: string,
  lineId: string,
): Promise<StoredImage | null> {
  if (!isUuid(lineId)) return null;
  const source = await withBuyerOrder(buyer, orderId, (tx, { shop, order }) =>
    readOrderLineImageSourceTx(tx, shop.tenantId, order.id, lineId),
  );
  return source ? readStoredImageOrNull(source.key, source.contentType, 'OrderLine') : null;
}

/** La foto del ramo finito (prova di consegna); null se non c'è o l'ordine è annullato. */
export async function getBuyerOrderPhoto(
  buyer: BuyerContext,
  orderId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage | null> {
  const photo = await withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    if (order.status === 'CANCELLED') return null;
    return tx.orderPhoto.findFirst({
      where: { tenantId: shop.tenantId, orderId: order.id, status: 'ACTIVE' },
      select: { storageKey: true, thumbKey: true, contentType: true },
    });
  });
  if (!photo) return null;
  return readStoredImageOrNull(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'OrderPhoto',
  );
}

/** Il logo della fioreria dell'ordine; null se non c'è. */
export async function getBuyerOrderShopLogo(
  buyer: BuyerContext,
  orderId: string,
): Promise<StoredImage | null> {
  const key = await withBuyerOrder(buyer, orderId, async (tx, { shop }) => {
    const store = await tx.onlineStore.findUnique({
      where: { tenantId: shop.tenantId },
      select: { logoKey: true },
    });
    return store?.logoKey ?? null;
  });
  return key ? readStoredImageOrNull(key, 'image/jpeg', 'OnlineStore') : null;
}

/** Il numero dell'ordine, per i titoli (senza leggere tutta la pagina). */
export function buyerOrderNumberLabel(order: Pick<BuyerOrderRow, 'number'>): string {
  return formatOrderNumber(order.number);
}
