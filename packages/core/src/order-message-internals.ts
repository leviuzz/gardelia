/**
 * Pezzi comuni dei messaggi degli ordini online (marketplace M3-1, ADR-088), usati dal lato della
 * fioreria (`services/order-messages.ts`) e da quello di chi compra (`buyer-orders.ts`): la forma di
 * un messaggio per chi guarda, la foto pronta da salvare, l'avviso per email all'altra parte.
 */
import type { TransactionClient } from '@floral/db';
import {
  newId,
  shouldSendMessageNotice,
  type OrderMessageAuthor,
  type OrderNoticeKind,
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
