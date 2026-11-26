/**
 * Pezzi comuni dei messaggi degli ordini online (marketplace M3-1, ADR-088), usati dal lato della
 * fioreria (`services/order-messages.ts`) e da quello di chi compra (`buyer-orders.ts`): la forma di
 * un messaggio per chi guarda, la foto pronta da salvare, l'avviso per email all'altra parte.
 */
import type { TransactionClient } from '@floral/db';
import {
  ORDER_MESSAGE_KINDS,
  newId,
  shouldSendMessageNotice,
  type OrderMessageAuthor,
  type OrderMessageKind,
  type OrderNoticeKind,
  type OrderQuestionAnswer,
} from '@floral/domain';
import { getObjectStorage } from './ai/storage';
import { logger } from './logger';
import { normalizeUploadedPhoto } from './media/images';
import type { FileToStore } from './media/stored-files';

export interface OrderMessageDto {
  readonly id: string;
  readonly authorKind: OrderMessageAuthor;
  /** Chi ha scritto; null = conto eliminato ("Cuenta eliminada"). */
  readonly authorName: string | null;
  readonly body: string;
  /** La foto si vede ancora (non tolta né cancellata). */
  readonly hasPhoto: boolean;
  /** C'era una foto, ma è stata tolta o cancellata (30 giorni dopo la chiusura dell'ordine). */
  readonly photoGone: boolean;
  readonly createdAt: Date;
  /** Da leggere per chi guarda: della fioreria per chi compra, di chi compra per la fioreria. */
  readonly unread: boolean;
  /** M3-2: un messaggio, una domanda «sì / no» della fioreria o la risposta di chi compra. */
  readonly kind: OrderMessageKind;
  /** La risposta («Sí» o «No»), sulle righe `ANSWER`. */
  readonly answer: OrderQuestionAnswer | null;
  /** Una domanda: la risposta di chi compra, se c'è già. */
  readonly reply: OrderQuestionAnswer | null;
}

export const orderMessageSelect = {
  id: true,
  authorKind: true,
  body: true,
  photoKey: true,
  photoRemovedAt: true,
  photoDeletedAt: true,
  createdAt: true,
  readByShopAt: true,
  author: { select: { name: true } },
  kind: true,
  answer: true,
  reply: { select: { answer: true } },
} as const;

interface OrderMessageRow {
  readonly id: string;
  readonly authorKind: OrderMessageAuthor;
  readonly body: string;
  readonly photoKey: string | null;
  readonly photoRemovedAt: Date | null;
  readonly photoDeletedAt: Date | null;
  readonly createdAt: Date;
  readonly readByShopAt: Date | null;
  readonly author: { readonly name: string } | null;
  readonly kind: string;
  readonly answer: string | null;
  readonly reply: { readonly answer: string | null } | null;
}

function asAnswer(value: string | null | undefined): OrderQuestionAnswer | null {
  return value === 'YES' || value === 'NO' ? value : null;
}

function asKind(value: string): OrderMessageKind {
  return (ORDER_MESSAGE_KINDS as readonly string[]).includes(value)
    ? (value as OrderMessageKind)
    : 'MESSAGE';
}

/** Un messaggio come lo vede la fioreria (`SHOP`) o chi ha fatto l'ordine (`BUYER`). */
export function toOrderMessageDto(
  row: OrderMessageRow,
  viewer: OrderMessageAuthor,
  buyerReadAt: Date | null = null,
): OrderMessageDto {
  const hasPhoto = row.photoKey !== null && !row.photoRemovedAt && !row.photoDeletedAt;
  const unread =
    viewer === 'SHOP'
      ? row.authorKind === 'BUYER' && row.readByShopAt === null
      : row.authorKind === 'SHOP' && (buyerReadAt === null || row.createdAt > buyerReadAt);
  return {
    id: row.id,
    authorKind: row.authorKind,
    authorName: row.author?.name ?? null,
    body: row.body,
    hasPhoto,
    photoGone: row.photoKey !== null && !hasPhoto,
    createdAt: row.createdAt,
    unread,
    kind: asKind(row.kind),
    answer: asAnswer(row.answer),
    reply: asAnswer(row.reply?.answer),
  };
}

export interface PreparedOrderMessagePhoto {
  readonly files: readonly FileToStore[];
  readonly row: {
    readonly photoKey: string;
    readonly photoThumbKey: string;
    readonly photoWidth: number;
    readonly photoHeight: number;
  };
}

/**
 * La foto di un messaggio, pronta da salvare: ridotta e senza EXIF (come quelle di Floral Care),
 * nella cartella della fioreria (`tenants/<id>/order-messages/`, CHECK nel database).
 */
export async function prepareOrderMessagePhoto(
  tenantId: string,
  orderId: string,
  bytes: Uint8Array,
): Promise<PreparedOrderMessagePhoto> {
  const image = await normalizeUploadedPhoto(bytes);
  const id = newId();
  const photoKey = `tenants/${tenantId}/order-messages/${orderId}-${id}.jpg`;
  const photoThumbKey = `tenants/${tenantId}/order-messages/${orderId}-${id}-thumb.jpg`;
  return {
    files: [
      { key: photoKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: photoThumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    row: {
      photoKey,
      photoThumbKey,
      photoWidth: image.full.width,
      photoHeight: image.full.height,
    },
  };
}

/** Cancella i file della foto di un messaggio; false se non ci riesce (riprova il lavoro giornaliero). */
export async function deleteOrderMessagePhotoFiles(message: {
  readonly id: string;
  readonly photoKey: string;
  readonly photoThumbKey: string | null;
}): Promise<boolean> {
  const storage = getObjectStorage();
  try {
    await storage.delete(message.photoKey);
    if (message.photoThumbKey) await storage.delete(message.photoThumbKey);
    return true;
  } catch (error) {
    logger.warn(
      { err: error, messageId: message.id },
      'file della foto di un messaggio non cancellati',
    );
    return false;
  }
}

/**
 * L'avviso per email all'altra parte quando arriva il messaggio `messageId` (nella stessa
 * transazione, con l'ordine bloccato): sì al primo da leggere, o di nuovo dopo 6 ore se è ancora da
 * leggere (`shouldSendMessageNotice`). Se tocca, segna l'ora dell'avviso e restituisce true.
 */
export async function claimMessageNoticeTx(
  tx: TransactionClient,
  input: {
    readonly tenantId: string;
    readonly orderId: string;
    readonly buyerUserId: string | null;
    /** Chi riceve l'avviso. */
    readonly to: OrderMessageAuthor;
    readonly messageId: string;
  },
): Promise<boolean> {
  const { tenantId, orderId } = input;
  let unreadBefore: number;
  if (input.to === 'SHOP') {
    unreadBefore = await tx.orderMessage.count({
      where: {
        tenantId,
        orderId,
        authorKind: 'BUYER',
        readByShopAt: null,
        id: { not: input.messageId },
      },
    });
  } else {
    if (!input.buyerUserId) return false;
    const read = await tx.orderBuyerRead.findUnique({
      where: {
        tenantId_orderId_userId: { tenantId, orderId, userId: input.buyerUserId },
      },
      select: { readAt: true },
    });
    unreadBefore = await tx.orderMessage.count({
      where: {
        tenantId,
        orderId,
        authorKind: 'SHOP',
        id: { not: input.messageId },
        ...(read ? { createdAt: { gt: read.readAt } } : {}),
      },
    });
  }
  const kind: OrderNoticeKind = input.to === 'SHOP' ? 'MESSAGE_TO_SHOP' : 'MESSAGE_TO_BUYER';
  const last = await tx.orderNotice.findUnique({
    where: { tenantId_orderId_kind: { tenantId, orderId, kind } },
    select: { sentAt: true },
  });
  if (!shouldSendMessageNotice({ unreadBefore, lastNoticeAt: last?.sentAt ?? null })) return false;
  const now = new Date();
  await tx.orderNotice.upsert({
    where: { tenantId_orderId_kind: { tenantId, orderId, kind } },
    create: { tenantId, orderId, kind, sentAt: now },
    update: { sentAt: now },
  });
  return true;
}

/**
 * Segna un'email automatica dell'ordine come mandata (passi, promemoria): true solo la prima volta,
 * così due giri o un passo avanti-indietro-avanti non la rimandano.
 */
/**
 * Il promemoria della scadenza (M3-2): uno per scadenza, non per ordine. Si prende se non è mai
 * partito o se l'ultimo è partito prima di `since` (l'inizio del conto: invio, ultima richiesta o
 * ultima risposta). Da chiamare sotto il lock dell'ordine.
 */
export async function claimReminderNoticeTx(
  tx: TransactionClient,
  input: { readonly tenantId: string; readonly orderId: string; readonly since: Date },
): Promise<boolean> {
  const renewed = await tx.orderNotice.updateMany({
    where: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      kind: 'EXPIRY_REMINDER',
      sentAt: { lt: input.since },
    },
    data: { sentAt: new Date() },
  });
  if (renewed.count > 0) return true;
  return claimOnceNoticeTx(tx, {
    tenantId: input.tenantId,
    orderId: input.orderId,
    kind: 'EXPIRY_REMINDER',
  });
}

export async function claimOnceNoticeTx(
  tx: TransactionClient,
  input: { readonly tenantId: string; readonly orderId: string; readonly kind: OrderNoticeKind },
): Promise<boolean> {
  const created = await tx.orderNotice.createManyAndReturn({
    data: [{ tenantId: input.tenantId, orderId: input.orderId, kind: input.kind }],
    skipDuplicates: true,
    select: { id: true },
  });
  return created.length > 0;
}
