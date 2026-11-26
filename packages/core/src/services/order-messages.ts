/**
 * Marketplace M3-1 (ADR-088) — i messaggi degli ordini online, lato fioreria.
 *
 *  - Un filo per ordine online, con chi l'ha fatto. Leggono e scrivono tutti i ruoli
 *    (`orders:messages`, come i messaggi di Floral Care); un messaggio di chi compra è "letto"
 *    quando qualcuno della squadra apre l'ordine.
 *  - Una foto facoltativa per messaggio, nella riga del messaggio (ridotta, senza EXIF, file privati
 *    sotto `tenants/<id>/order-messages/`); chi gestisce gli ordini la può togliere e i file si
 *    cancellano subito.
 *  - Quando la fioreria scrive, chi compra riceve un'email al primo messaggio da leggere e, se non
 *    legge, di nuovo al massimo ogni 6 ore; mai il testo. Parte dopo il commit e non fa mai fallire
 *    l'invio del messaggio.
 *  - Lo stesso modulo inviato due volte (chiave `submitKey`) non scrive due messaggi.
 *  - I messaggi non si modificano né si cancellano; il testo non va mai nel registro.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ORDER_MESSAGE_LIMITS,
  formatOrderNumber,
  hasOrderThread,
  isUuid,
  newId,
  orderMessagePages,
  orderMessageProblem,
  orderStaffMessageSchema,
  orderMessagesOpen,
  pendingOrderDeadline,
  toFieldErrors,
  type OrderQuestionContext,
  type OrderStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { EmailMessage } from '../mailer';
import {
  deleteUnusedFiles,
  readStoredImage,
  storeFilesThenCommit,
  type StoredImage,
} from '../media/stored-files';
import {
  claimMessageNoticeTx,
  deleteOrderMessagePhotoFiles,
  orderMessageSelect,
  prepareOrderMessagePhoto,
  toOrderMessageDto,
  type OrderMessageDto,
  type PreparedOrderMessagePhoto,
} from '../order-message-internals';
import { buyerMessageNoticeMail, sendOrderMails, type OrderMailDeps } from '../order-mail';
import type { PhotoVariant } from './catalog-photos';
import { dateToParts } from './quote-internals';

export interface OrderThreadDto {
  readonly orderId: string;
  readonly numberLabel: string;
  /** Chi ha fatto l'ordine (il nome del suo conto). */
  readonly buyerName: string;
  /** Si scrive fino a 7 giorni dopo la consegna, il ritiro o l'annullamento. */
  readonly open: boolean;
  /** Dal più vecchio al più recente (gli ultimi `pages` × 30). */
  readonly messages: readonly OrderMessageDto[];
  readonly hasOlder: boolean;
  readonly unreadCount: number;
  /** Chi gestisce gli ordini può togliere la foto di un messaggio. */
  readonly canRemovePhotos: boolean;
}

export interface OrderMessagePostResult {
  readonly id: string;
  /** Lo stesso invio era già arrivato: nessun messaggio in più. */
  readonly duplicate: boolean;
  /** È partito l'avviso per email a chi ha fatto l'ordine. */
  readonly notified: boolean;
}

/** «Da gestire» (M3-1): cosa aspetta la fioreria sugli ordini online. */
export interface OrderInboxDto {
  /**
   * Ordini online da accettare, e la scadenza più vicina. Non contano quelli che aspettano la
   * conferma di chi compra né quelli tornati dopo un «No, gracias» (M3-2: `declinedChanges`).
   */
  readonly pendingOnline: number;
  readonly firstDeadline: Date | null;
  /** Ordini online tornati alla fioreria dopo un «No, gracias» ai cambi (M3-2). */
  readonly declinedChanges: number;
  /** Messaggi di chi compra da leggere, e in quanti ordini. */
  readonly unreadMessages: number;
  readonly unreadOrders: number;
}

const orderThreadSelect = {
  id: true,
  number: true,
  status: true,
  statusChangedAt: true,
  placedOnline: true,
  buyerUserId: true,
  buyer: { select: { name: true } },
} as const;

/** Il filo di un ordine online: gli ultimi messaggi (`pages` × 30). Null se l'ordine non ha il filo. */
export async function getOrderThread(
  ctx: TenantContext,
  orderId: string,
  pages = 1,
): Promise<OrderThreadDto | null> {
  requirePermission(ctx, 'orders:messages');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const take = ORDER_MESSAGE_LIMITS.page * orderMessagePages(pages);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: orderThreadSelect,
    });
    if (!order) return null;
    if (!order.placedOnline) return { order, rows: [], unreadCount: 0 };
    const [rows, unreadCount] = await Promise.all([
      tx.orderMessage.findMany({
        where: { tenantId: ctx.tenantId, orderId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        select: orderMessageSelect,
      }),
      tx.orderMessage.count({
        where: { tenantId: ctx.tenantId, orderId, authorKind: 'BUYER', readByShopAt: null },
      }),
    ]);
    return { order, rows, unreadCount };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  const { order, rows } = found;
  // Gli ordini del banco non hanno il filo; un ordine online di un conto eliminato lo tiene da
  // leggere (i messaggi restano alla fioreria).
  if (!order.placedOnline) return null;
  if (!hasOrderThread(order) && rows.length === 0) return null;
  return {
    orderId: order.id,
    numberLabel: formatOrderNumber(order.number),
    buyerName: order.buyer?.name ?? '',
    open: orderMessagesOpen(order),
    messages: rows
      .slice(0, take)
      .reverse()
      .map((row) => toOrderMessageDto(row, 'SHOP')),
    hasOlder: rows.length > take,
    unreadCount: found.unreadCount,
    canRemovePhotos: hasPermission(ctx, 'orders:write'),
  };
}

/** Segna come letti i messaggi di chi compra dell'ordine (per tutta la squadra). */
export async function markOrderThreadRead(ctx: TenantContext, orderId: string): Promise<number> {
  requirePermission(ctx, 'orders:messages');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const marked = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: { id: true },
    });
    if (!order) return null;
    const updated = await tx.orderMessage.updateMany({
      where: { tenantId: ctx.tenantId, orderId, authorKind: 'BUYER', readByShopAt: null },
      data: { readByShopAt: new Date() },
    });
    return updated.count;
  });
  if (marked === null) return notFound(ctx, 'Order', orderId);
  return marked;
}

/** L'ordine bloccato per scrivere: chi lo chiude nello stesso momento aspetta il messaggio. */
async function lockThreadOrder(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<{
  readonly status: OrderStatus;
  readonly statusChangedAt: Date;
  readonly placedOnline: boolean;
  readonly buyerUserId: string | null;
} | null> {
  const rows = await tx.$queryRaw<
    {
      status: OrderStatus;
      statusChangedAt: Date;
      placedOnline: boolean;
      buyerUserId: string | null;
    }[]
  >`
    SELECT "status"::text AS status, "statusChangedAt", "placedOnline", "buyerUserId"
    FROM "Order"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${orderId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Scrive un messaggio della fioreria (o una domanda «sì / no», M3-2) nella transazione che ha
 * bloccato l'ordine, e prepara l'avviso a chi compra al primo da leggere. Lo stesso invio arrivato
 * due volte scrive una volta sola (`submitKey`).
 */
async function insertShopMessageTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
  order: { readonly buyerUserId: string | null },
  row: {
    readonly id: string;
    readonly body: string;
    readonly question: boolean;
    readonly questionContext?: OrderQuestionContext;
    readonly submitKey: string;
    readonly photo: PreparedOrderMessagePhoto['row'] | null;
  },
  mail: OrderMailDeps | null,
): Promise<{ id: string; duplicate: boolean; mail: EmailMessage | null }> {
  const created = await tx.orderMessage.createManyAndReturn({
    data: [
      {
        id: row.id,
        tenantId: ctx.tenantId,
        orderId,
        authorKind: 'SHOP',
        authorUserId: ctx.userId,
        body: row.body,
        ...(row.question ? { kind: 'QUESTION' } : {}),
        ...(row.questionContext
          ? { questionContext: row.questionContext as unknown as Prisma.InputJsonValue }
          : {}),
        ...(row.photo ?? {}),
        submitKey: row.submitKey,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length === 0) {
    // Lo stesso invio arrivato insieme: il primo ha già scritto il messaggio.
    const existing = await tx.orderMessage.findFirst({
      where: { tenantId: ctx.tenantId, submitKey: row.submitKey },
      select: { id: true },
    });
    return { id: existing?.id ?? row.id, duplicate: true, mail: null };
  }
  const notify = await claimMessageNoticeTx(tx, {
    tenantId: ctx.tenantId,
    orderId,
    buyerUserId: order.buyerUserId,
    to: 'BUYER',
    messageId: row.id,
  });
  const notice =
    notify && mail ? await buyerMessageNoticeMail(tx, ctx.tenantId, orderId, mail) : null;
  return { id: row.id, duplicate: false, mail: notice };
}

/**
 * Una domanda «sì / no» della fioreria scritta dal server, con il suo contesto (M3-2: «Chiedi
 * nell'app» in «Mancano fiori»). Il testo e il contesto li prepara chi chiama, dal database.
 */
export async function postShopQuestion(
  ctx: TenantContext,
  orderId: string,
  input: { readonly body: string; readonly questionContext: OrderQuestionContext },
  mail: OrderMailDeps | null,
): Promise<OrderMessagePostResult> {
  requirePermission(ctx, 'orders:messages');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const id = newId();
  const saved = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockThreadOrder(tx, ctx.tenantId, orderId);
    if (!order) return null;
    if (!orderMessagesOpen(order)) throw new ConflictError('order_message_closed');
    return insertShopMessageTx(
      tx,
      ctx,
      orderId,
      order,
      {
        id,
        body: input.body,
        question: true,
        questionContext: input.questionContext,
        submitKey: id,
        photo: null,
      },
      mail,
    );
  });
  if (!saved) return notFound(ctx, 'Order', orderId);
  if (mail && saved.mail) await sendOrderMails(mail.mailer, [saved.mail]);
  return { id: saved.id, duplicate: saved.duplicate, notified: saved.mail !== null };
}

/**
 * Scrive un messaggio della fioreria (testo e/o una foto). Chi ha fatto l'ordine riceve l'avviso
 * per email al primo messaggio da leggere (o di nuovo dopo 6 ore), dopo il commit.
 */
export async function postOrderMessage(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  photo: Uint8Array | null,
  mail: OrderMailDeps | null,
): Promise<OrderMessagePostResult> {
  requirePermission(ctx, 'orders:messages');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  // Con la casella «Domanda sì / no» il messaggio è una domanda (M3-2): sempre col testo.
  const parsed = orderStaffMessageSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const hasPhoto = photo !== null && photo.byteLength > 0;

  // Prima un controllo veloce, così un messaggio rifiutato non elabora né carica la foto.
  const precheck = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: orderThreadSelect,
    });
    if (!order) return null;
    const existing = await tx.orderMessage.findFirst({
      where: { tenantId: ctx.tenantId, submitKey: input.submitKey },
      select: { id: true },
    });
    if (existing) return { duplicate: existing.id };
    const problem = orderMessageProblem({
      order,
      body: input.body,
      hasPhoto,
      question: input.question,
    });
    if (problem === 'order_message_closed') throw new ConflictError(problem);
    if (problem) throw new ValidationError({ body: problem });
    return { duplicate: null };
  });
  if (!precheck) return notFound(ctx, 'Order', orderId);
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true, notified: false };

  const prepared = hasPhoto ? await prepareOrderMessagePhoto(ctx.tenantId, orderId, photo) : null;
  const id = newId();
  const commit = () =>
    withTenantContext(getDb(), ctx, async (tx) => {
      const order = await lockThreadOrder(tx, ctx.tenantId, orderId);
      if (!order) return null;
      if (!orderMessagesOpen(order)) throw new ConflictError('order_message_closed');
      return insertShopMessageTx(
        tx,
        ctx,
        orderId,
        order,
        {
          id,
          body: input.body,
          question: input.question,
          submitKey: input.submitKey,
          photo: prepared?.row ?? null,
        },
        mail,
      );
    });
  const saved = prepared ? await storeFilesThenCommit(prepared.files, commit) : await commit();
  if (!saved) return notFound(ctx, 'Order', orderId);
  if (saved.duplicate && prepared) {
    await deleteUnusedFiles(prepared.files.map((file) => file.key));
  }
  if (mail && saved.mail) await sendOrderMails(mail.mailer, [saved.mail]);
  return { id: saved.id, duplicate: saved.duplicate, notified: saved.mail !== null };
}

/** Chi gestisce gli ordini toglie la foto di un messaggio: i file si cancellano subito, il testo resta. */
export async function removeOrderMessagePhoto(
  ctx: TenantContext,
  orderId: string,
  messageId: string,
): Promise<void> {
  requirePermission(ctx, 'orders:messages');
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  if (!isUuid(messageId)) throw new NotFoundError('OrderMessage');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const message = await tx.orderMessage.findFirst({
      where: { tenantId: ctx.tenantId, id: messageId, orderId },
      select: {
        id: true,
        photoKey: true,
        photoThumbKey: true,
        photoRemovedAt: true,
        order: { select: { number: true } },
      },
    });
    if (!message) return { kind: 'missing' } as const;
    if (!message.photoKey || message.photoRemovedAt) return { kind: 'already' } as const;
    await tx.orderMessage.update({
      where: { id: message.id, tenantId: ctx.tenantId },
      data: { photoRemovedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderMessagePhotoRemoved,
      entityType: 'OrderMessage',
      entityId: message.id,
      metadata: { number: formatOrderNumber(message.order.number) },
    });
    return {
      kind: 'removed',
      files: { id: message.id, photoKey: message.photoKey, photoThumbKey: message.photoThumbKey },
    } as const;
  });
  if (result.kind === 'missing') return notFound(ctx, 'OrderMessage', messageId);
  if (result.kind === 'already') return;
  if (await deleteOrderMessagePhotoFiles(result.files)) {
    await withTenantContext(getDb(), ctx, (tx) =>
      tx.orderMessage.updateMany({
        where: { tenantId: ctx.tenantId, id: result.files.id, photoDeletedAt: null },
        data: { photoDeletedAt: new Date() },
      }),
    );
  }
}

/** La foto di un messaggio dell'ordine (`thumb` = miniatura), finché si vede. */
export async function getOrderMessagePhotoImage(
  ctx: TenantContext,
  orderId: string,
  messageId: string,
  variant: PhotoVariant,
): Promise<StoredImage> {
  requirePermission(ctx, 'orders:messages');
  if (!isUuid(orderId) || !isUuid(messageId)) throw new NotFoundError('OrderMessage');
  const message = await withTenantContext(getDb(), ctx, (tx) =>
    tx.orderMessage.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: messageId,
        orderId,
        photoKey: { not: null },
        photoRemovedAt: null,
        photoDeletedAt: null,
      },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!message?.photoKey) return notFound(ctx, 'OrderMessage', messageId);
  const key = variant === 'thumb' ? (message.photoThumbKey ?? message.photoKey) : message.photoKey;
  return readStoredImage(key, 'image/jpeg', 'OrderMessage');
}

/**
 * Ordini online da accettare che aspettano la fioreria (M3-2): né in attesa della conferma di chi
 * compra né tornati dopo un «No, gracias» (`excludeDeclined`, per contarli a parte).
 */
function awaitingShopWhere(
  tenantId: string,
  excluded: readonly ('ASKED' | 'DECLINED')[],
): Prisma.OrderWhereInput {
  return {
    tenantId,
    status: 'PENDING_ACCEPTANCE',
    placedOnline: true,
    OR: [
      { changeRequest: { is: null } },
      { changeRequest: { is: { status: { notIn: [...excluded] } } } },
    ],
  };
}

/** «Da gestire»: ordini online da accettare (con la scadenza più vicina) e messaggi da leggere. */
export async function getOrderInbox(ctx: TenantContext): Promise<OrderInboxDto> {
  requirePermission(ctx, 'orders:read');
  const canReadMessages = hasPermission(ctx, 'orders:messages');
  return withTenantContext(getDb(), ctx, async (tx) => {
    const toAccept = awaitingShopWhere(ctx.tenantId, ['ASKED', 'DECLINED']);
    const pending = await tx.order.findMany({
      where: toAccept,
      select: {
        createdAt: true,
        scheduledDate: true,
        changeRequest: { select: { askedAt: true, answeredAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const deadlines = pending
      .map((order) =>
        pendingOrderDeadline(
          {
            createdAt: order.createdAt,
            scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
            changeAskedAt: order.changeRequest?.askedAt ?? null,
            changeAnsweredAt: order.changeRequest?.answeredAt ?? null,
          },
          ctx.timezone,
        ),
      )
      .sort((a, b) => a.getTime() - b.getTime());
    const [pendingOnline, declinedChanges] = await Promise.all([
      tx.order.count({ where: toAccept }),
      tx.order.count({
        where: {
          tenantId: ctx.tenantId,
          status: 'PENDING_ACCEPTANCE',
          placedOnline: true,
          changeRequest: { is: { status: 'DECLINED' } },
        },
      }),
    ]);
    if (!canReadMessages) {
      return {
        pendingOnline,
        firstDeadline: deadlines[0] ?? null,
        declinedChanges,
        unreadMessages: 0,
        unreadOrders: 0,
      };
    }
    const rows = await tx.$queryRaw<{ unread: number; orders: number }[]>`
      SELECT count(*)::int AS unread, count(DISTINCT m."orderId")::int AS orders
      FROM "OrderMessage" m
      WHERE m."tenantId" = ${ctx.tenantId}::uuid
        AND m."authorKind" = 'BUYER'
        AND m."readByShopAt" IS NULL`;
    return {
      pendingOnline,
      firstDeadline: deadlines[0] ?? null,
      declinedChanges,
      unreadMessages: rows[0]?.unread ?? 0,
      unreadOrders: rows[0]?.orders ?? 0,
    };
  });
}

/**
 * Il numero sulla voce «Ordini» del menu (M3): gli ordini online da accettare, solo per chi li può
 * accettare (gli altri vedono 0). Con M3-2 contano anche quelli tornati dopo un «No, gracias», non
 * quelli che aspettano la conferma di chi compra. Una sola query leggera: la chiede ogni pagina.
 */
export async function countPendingOnlineOrders(ctx: TenantContext): Promise<number> {
  requirePermission(ctx, 'orders:read');
  if (!hasPermission(ctx, 'orders:write')) return 0;
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.order.count({ where: awaitingShopWhere(ctx.tenantId, ['ASKED']) }),
  );
}

/** Foto per giro del lavoro giornaliero (il resto al giro dopo). */
const PURGE_BATCH = 200;

/**
 * Lavoro giornaliero (M3): cancella i file delle foto dei messaggi 30 giorni dopo la chiusura
 * dell'ordine (o dopo il suo giorno, se è rimasto aperto) e quelli tolti dalla fioreria che non si
 * erano potuti cancellare. Il testo e le chiavi restano; `photoDeletedAt` dice che i file non ci
 * sono più. La funzione SQL dà solo gli ID; ogni messaggio si ricontrolla nella sua fioreria.
 */
export async function purgeOrderMessagePhotos(): Promise<number> {
  const candidates = await getDb().$queryRaw<{ tenant_id: string; message_id: string }[]>`
    SELECT tenant_id, message_id
    FROM app_order_message_photos_to_purge(
      ${ORDER_MESSAGE_LIMITS.photoRetentionDays}::int,
      ${PURGE_BATCH}::int
    )`;
  let deleted = 0;
  for (const candidate of candidates) {
    try {
      const scope = { tenantId: candidate.tenant_id, userId: null };
      const message = await withTenantContext(getDb(), scope, (tx) =>
        tx.orderMessage.findFirst({
          where: {
            tenantId: candidate.tenant_id,
            id: candidate.message_id,
            photoKey: { not: null },
            photoDeletedAt: null,
          },
          select: { id: true, photoKey: true, photoThumbKey: true },
        }),
      );
      if (!message?.photoKey) continue;
      const removed = await deleteOrderMessagePhotoFiles({
        id: message.id,
        photoKey: message.photoKey,
        photoThumbKey: message.photoThumbKey,
      });
      if (!removed) continue;
      await withTenantContext(getDb(), scope, (tx) =>
        tx.orderMessage.updateMany({
          where: { tenantId: candidate.tenant_id, id: message.id, photoDeletedAt: null },
          data: { photoDeletedAt: new Date() },
        }),
      );
      deleted += 1;
    } catch (error) {
      logger.error(
        { err: error, messageId: candidate.message_id },
        'foto di un messaggio non cancellata',
      );
    }
  }
  return deleted;
}
