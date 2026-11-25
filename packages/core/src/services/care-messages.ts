/**
 * Floral Care, blocco 5b (ADR-084) — i messaggi lato fioreria.
 *
 *  - Un filo per contratto. Leggono e scrivono tutti i ruoli (`care:messages`, decisione del
 *    founder del 24/11); un messaggio del cliente è "letto" quando qualcuno della squadra apre il
 *    filo.
 *  - Una foto facoltativa per messaggio, con la stessa catena delle foto delle visite (ridotta,
 *    senza EXIF, file privati sotto `tenants/<id>/care-photos/`); chi gestisce la può togliere e il
 *    file si cancella subito (ADR-078).
 *  - Quando la fioreria scrive, al cliente parte al massimo un avviso al giorno per contratto
 *    (decisione del founder), solo se qualcuno ha accesso a Mi Floral Care e solo da una fioreria
 *    LIVE; dopo il commit, con il tetto di tempo comune delle email di Floral Care.
 *  - Lo stesso modulo inviato due volte (chiave `submitKey`) non scrive due messaggi.
 *  - I messaggi non si modificano né si cancellano; il testo non va mai nel registro.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_MESSAGE_LIMITS,
  careEmailsAllowed,
  careMessageProblem,
  careMessageSchema,
  careMessagesOpen,
  formatSubscriptionNumber,
  isUuid,
  newId,
  toFieldErrors,
  todayInTimeZone,
  type CareMessageAuthor,
  type CustomerSubscriptionStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';
import {
  deleteUnusedFiles,
  readStoredImage,
  storeFilesThenCommit,
  type FileToStore,
  type StoredImage,
} from '../media/stored-files';
import { requireEntitlement } from './billing';
import type { PhotoVariant } from './catalog-photos';
import { dbDate } from './care-internals';
import { portalAccessCountTx } from './care-message-internals';
import { deleteCarePhotoFiles } from './care-photos';
import { deliverCareEmailsWithin, type CareMailDeps } from './care-visit-work';

// -----------------------------------------------------------------------------
// Tipi
// -----------------------------------------------------------------------------

export interface CareMessageDto {
  readonly id: string;
  readonly authorKind: CareMessageAuthor;
  /** Chi ha scritto; null = conto eliminato ("Cuenta eliminada"). */
  readonly authorName: string | null;
  readonly body: string;
  /** La foto da mostrare; null se non c'era o non c'è più. */
  readonly photoId: string | null;
  /** C'era una foto, ma è stata tolta o cancellata (a fine contratto + 30 giorni). */
  readonly photoGone: boolean;
  readonly createdAt: Date;
  /** Messaggio del cliente ancora da leggere quando si è aperto il filo. */
  readonly unread: boolean;
}

export interface CareThreadDto {
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  /** Si scrive solo con il contratto attivo o in pausa. */
  readonly open: boolean;
  /** Persone che vedono il contratto in Mi Floral Care (0 = per ora non legge nessuno). */
  readonly accessCount: number;
  /** Dal più vecchio al più recente (gli ultimi `pages` × 30). */
  readonly messages: readonly CareMessageDto[];
  readonly hasOlder: boolean;
  readonly unreadCount: number;
  /** Chi gestisce i contratti può togliere la foto di un messaggio. */
  readonly canRemovePhotos: boolean;
}

export interface CareThreadSummaryDto {
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  readonly siteLabel: string | null;
  readonly status: CustomerSubscriptionStatus;
  readonly unreadCount: number;
  readonly lastAt: Date;
  readonly last: {
    readonly authorKind: CareMessageAuthor;
    /** L'inizio del testo (vuoto se c'è solo la foto). */
    readonly preview: string;
    readonly hasPhoto: boolean;
  };
}

export interface CareThreadListDto {
  readonly threads: readonly CareThreadSummaryDto[];
  readonly page: number;
  readonly hasMore: boolean;
}

export interface CareUnreadMessagesDto {
  readonly unread: number;
  readonly threads: number;
}

export interface CareMessagePostResult {
  readonly id: string;
  /** Lo stesso invio era già arrivato: nessun messaggio in più. */
  readonly duplicate: boolean;
  /** È partito (o è in coda) l'avviso di oggi al cliente. */
  readonly notified: boolean;
}

const PREVIEW_CHARS = 140;

const messageSelect = {
  id: true,
  authorKind: true,
  authorUserId: true,
  body: true,
  hasPhoto: true,
  createdAt: true,
  readByShopAt: true,
  author: { select: { name: true } },
  photo: { select: { id: true, removedAt: true, deletedAt: true } },
} as const;

type MessageRow = {
  readonly id: string;
  readonly authorKind: CareMessageAuthor;
  readonly authorUserId: string | null;
  readonly body: string;
  readonly hasPhoto: boolean;
  readonly createdAt: Date;
  readonly readByShopAt: Date | null;
  readonly author: { readonly name: string } | null;
  readonly photo: {
    readonly id: string;
    readonly removedAt: Date | null;
    readonly deletedAt: Date | null;
  } | null;
};

/** Un messaggio come lo mostrano la fioreria e il portale (la foto solo se si vede ancora). */
export function toCareMessageDto(row: MessageRow): CareMessageDto {
  const visible = row.photo && !row.photo.removedAt && !row.photo.deletedAt ? row.photo.id : null;
  return {
    id: row.id,
    authorKind: row.authorKind,
    authorName: row.author?.name ?? null,
    body: row.body,
    photoId: visible,
    photoGone: row.hasPhoto && visible === null,
    createdAt: row.createdAt,
    unread: row.authorKind === 'CUSTOMER' && row.readByShopAt === null,
  };
}

export { messageSelect as careMessageSelect };

function pagesOf(pages: number): number {
  return Number.isInteger(pages) ? Math.min(Math.max(pages, 1), 20) : 1;
}

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Il filo di un contratto: gli ultimi messaggi (`pages` × 30) e chi lo vede dal portale. */
export async function getCareThread(
  ctx: TenantContext,
  subscriptionId: string,
  pages = 1,
): Promise<CareThreadDto> {
  requirePermission(ctx, 'care:messages');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const take = CARE_MESSAGE_LIMITS.page * pagesOf(pages);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        customer: { select: { displayName: true } },
      },
    });
    if (!contract) return null;
    const [rows, accessCount, unreadCount] = await Promise.all([
      tx.careMessage.findMany({
        where: { tenantId: ctx.tenantId, subscriptionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        select: messageSelect,
      }),
      portalAccessCountTx(tx, ctx.tenantId, subscriptionId, contract.customerId),
      tx.careMessage.count({
        where: {
          tenantId: ctx.tenantId,
          subscriptionId,
          authorKind: 'CUSTOMER',
          readByShopAt: null,
        },
      }),
    ]);
    return { contract, rows, accessCount, unreadCount };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  const { contract, rows } = found;
  return {
    subscriptionId: contract.id,
    numberLabel: formatSubscriptionNumber(contract.number),
    customerName: contract.customer.displayName,
    open: careMessagesOpen(contract.status),
    accessCount: found.accessCount,
    messages: rows.slice(0, take).reverse().map(toCareMessageDto),
    hasOlder: rows.length > take,
    unreadCount: found.unreadCount,
    canRemovePhotos: hasPermission(ctx, 'subscriptions:write'),
  };
}

/** Segna come letti i messaggi del cliente del contratto (per tutta la squadra). */
export async function markCareThreadRead(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<number> {
  requirePermission(ctx, 'care:messages');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const marked = await withTenantContext(getDb(), ctx, async (tx) => {
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { id: true },
    });
    if (!contract) return null;
    const updated = await tx.careMessage.updateMany({
      where: {
        tenantId: ctx.tenantId,
        subscriptionId,
        authorKind: 'CUSTOMER',
        readByShopAt: null,
      },
      data: { readByShopAt: new Date() },
    });
    return updated.count;
  });
  if (marked === null) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return marked;
}

/** «Mensajes»: i contratti con messaggi, prima quelli con messaggi del cliente da leggere. */
export async function listCareThreads(ctx: TenantContext, page = 1): Promise<CareThreadListDto> {
  requirePermission(ctx, 'care:messages');
  const size = CARE_MESSAGE_LIMITS.threadsPage;
  const current = Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1;
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const rows = await tx.$queryRaw<{ subscription_id: string; unread: number; last_at: Date }[]>`
      SELECT m."subscriptionId" AS subscription_id,
             (count(*) FILTER (WHERE m."authorKind" = 'CUSTOMER' AND m."readByShopAt" IS NULL))::int AS unread,
             max(m."createdAt") AS last_at
      FROM "CareMessage" m
      WHERE m."tenantId" = ${ctx.tenantId}::uuid
      GROUP BY m."subscriptionId"
      ORDER BY (count(*) FILTER (WHERE m."authorKind" = 'CUSTOMER' AND m."readByShopAt" IS NULL) > 0) DESC,
               max(m."createdAt") DESC,
               m."subscriptionId"
      LIMIT ${size + 1} OFFSET ${(current - 1) * size}`;
    const shown = rows.slice(0, size);
    const ids = shown.map((row) => row.subscription_id);
    const [contracts, lasts] = await Promise.all([
      tx.customerSubscription.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        select: {
          id: true,
          number: true,
          status: true,
          customer: { select: { displayName: true } },
          customerAddress: { select: { label: true, addressLine1: true } },
        },
      }),
      tx.careMessage.findMany({
        where: { tenantId: ctx.tenantId, subscriptionId: { in: ids } },
        orderBy: [{ subscriptionId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['subscriptionId'],
        select: { subscriptionId: true, authorKind: true, body: true, hasPhoto: true },
      }),
    ]);
    const byId = new Map(contracts.map((contract) => [contract.id, contract]));
    const lastById = new Map(lasts.map((last) => [last.subscriptionId, last]));
    const threads: CareThreadSummaryDto[] = [];
    for (const row of shown) {
      const contract = byId.get(row.subscription_id);
      const last = lastById.get(row.subscription_id);
      if (!contract || !last) continue;
      const address = contract.customerAddress;
      threads.push({
        subscriptionId: contract.id,
        numberLabel: formatSubscriptionNumber(contract.number),
        customerName: contract.customer.displayName,
        siteLabel: address ? (address.label ?? address.addressLine1) : null,
        status: contract.status,
        unreadCount: row.unread,
        lastAt: row.last_at,
        last: {
          authorKind: last.authorKind,
          preview: previewOf(last.body),
          hasPhoto: last.hasPhoto,
        },
      });
    }
    return { threads, page: current, hasMore: rows.length > size };
  });
}

/**
 * I messaggi del cliente da leggere (riquadro del pannello e scheda «Mensajes»); null per chi non
 * vede i messaggi.
 */
export async function countUnreadCareMessages(
  ctx: TenantContext,
): Promise<CareUnreadMessagesDto | null> {
  if (!hasPermission(ctx, 'care:messages')) return null;
  const rows = await withTenantContext(
    getDb(),
    ctx,
    (tx) =>
      tx.$queryRaw<{ unread: number; threads: number }[]>`
        SELECT count(*)::int AS unread, count(DISTINCT m."subscriptionId")::int AS threads
        FROM "CareMessage" m
        WHERE m."tenantId" = ${ctx.tenantId}::uuid
          AND m."authorKind" = 'CUSTOMER'
          AND m."readByShopAt" IS NULL`,
  );
  return { unread: rows[0]?.unread ?? 0, threads: rows[0]?.threads ?? 0 };
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

interface PreparedPhoto {
  readonly id: string;
  readonly files: readonly FileToStore[];
  readonly row: {
    readonly storageKey: string;
    readonly thumbKey: string;
    readonly contentType: string;
    readonly width: number;
    readonly height: number;
    readonly sizeBytes: number;
  };
}

/**
 * La foto di un messaggio, pronta da salvare: ridotta e senza EXIF, chiavi della fioreria del
 * contratto (le stesse delle foto delle visite: si cancellano con loro).
 */
export async function prepareCareMessagePhoto(
  tenantId: string,
  subscriptionId: string,
  bytes: Uint8Array,
): Promise<PreparedPhoto> {
  const image = await normalizeUploadedPhoto(bytes);
  const id = newId();
  const storageKey = `tenants/${tenantId}/care-photos/${subscriptionId}-${id}.jpg`;
  const thumbKey = `tenants/${tenantId}/care-photos/${subscriptionId}-${id}-thumb.jpg`;
  return {
    id,
    files: [
      { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    row: {
      storageKey,
      thumbKey,
      contentType: image.full.contentType,
      width: image.full.width,
      height: image.full.height,
      sizeBytes: image.full.bytes.byteLength,
    },
  };
}

/** Il contratto in lettura condivisa: chi lo chiude nello stesso momento aspetta il messaggio. */
async function lockOpenContract(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<{ readonly customerId: string } | null> {
  const rows = await tx.$queryRaw<{ status: CustomerSubscriptionStatus; customerId: string }[]>`
    SELECT "status"::text AS status, "customerId"
    FROM "CustomerSubscription"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${subscriptionId}::uuid AND "kind" = 'CARE'
    FOR SHARE`;
  const row = rows[0];
  if (!row) return null;
  if (!careMessagesOpen(row.status)) throw new ConflictError('care_message_closed');
  return { customerId: row.customerId };
}

/**
 * Scrive un messaggio della fioreria (testo e/o una foto). Con almeno una persona con accesso, in
 * una fioreria LIVE, mette in coda l'avviso di oggi al cliente (uno al giorno per contratto) e lo
 * manda dopo il commit.
 */
export async function postCareMessage(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
  photo: Uint8Array | null,
  mail: CareMailDeps | null,
): Promise<CareMessagePostResult> {
  requirePermission(ctx, 'care:messages');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careMessageSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const hasPhoto = photo !== null && photo.byteLength > 0;

  // Prima un controllo veloce, così un messaggio rifiutato non elabora né carica la foto.
  const precheck = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { status: true },
    });
    if (!contract) return null;
    const existing = await tx.careMessage.findFirst({
      where: { tenantId: ctx.tenantId, submitKey: input.submitKey },
      select: { id: true },
    });
    if (existing) return { duplicate: existing.id };
    const problem = careMessageProblem({ status: contract.status, body: input.body, hasPhoto });
    if (problem === 'care_message_closed') throw new ConflictError(problem);
    if (problem === 'care_message_empty') throw new ValidationError({ body: problem });
    return { duplicate: null };
  });
  if (!precheck) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true, notified: false };

  const prepared = hasPhoto
    ? await prepareCareMessagePhoto(ctx.tenantId, subscriptionId, photo)
    : null;
  const id = newId();
  const commit = () =>
    withTenantContext(getDb(), ctx, async (tx) => {
      const contract = await lockOpenContract(tx, ctx.tenantId, subscriptionId);
      if (!contract) return null;
      const created = await tx.careMessage.createManyAndReturn({
        data: [
          {
            id,
            tenantId: ctx.tenantId,
            customerId: contract.customerId,
            subscriptionId,
            authorKind: 'SHOP',
            authorUserId: ctx.userId,
            body: input.body,
            hasPhoto,
            submitKey: input.submitKey,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      if (created.length === 0) {
        // Lo stesso invio arrivato insieme: il primo ha già scritto il messaggio.
        const existing = await tx.careMessage.findFirst({
          where: { tenantId: ctx.tenantId, submitKey: input.submitKey },
          select: { id: true },
        });
        return { id: existing?.id ?? id, duplicate: true, noticeId: null };
      }
      if (prepared) {
        await tx.carePhoto.create({
          data: {
            id: prepared.id,
            tenantId: ctx.tenantId,
            subscriptionId,
            messageId: id,
            ...prepared.row,
            createdById: ctx.userId,
          },
        });
      }
      let noticeId: string | null = null;
      if (
        careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' }) &&
        (await portalAccessCountTx(tx, ctx.tenantId, subscriptionId, contract.customerId)) > 0
      ) {
        const notice = await tx.careEmail.createManyAndReturn({
          data: [
            {
              tenantId: ctx.tenantId,
              kind: 'MESSAGE_NOTICE',
              subscriptionId,
              noticeDay: dbDate(todayInTimeZone(ctx.timezone)),
              requestedById: ctx.userId,
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        noticeId = notice[0]?.id ?? null;
      }
      return { id, duplicate: false, noticeId };
    });
  const saved = prepared ? await storeFilesThenCommit(prepared.files, commit) : await commit();
  if (!saved) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  if (saved.duplicate && prepared) {
    await deleteUnusedFiles(prepared.files.map((file) => file.key));
  }
  if (saved.noticeId) {
    await deliverCareEmailsWithin(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      [saved.noticeId],
      mail,
    );
  }
  return { id: saved.id, duplicate: saved.duplicate, notified: saved.noticeId !== null };
}

/** Chi gestisce toglie la foto di un messaggio: il file si cancella subito, il testo resta. */
export async function removeCareMessagePhoto(
  ctx: TenantContext,
  subscriptionId: string,
  messageId: string,
): Promise<void> {
  requirePermission(ctx, 'care:messages');
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  if (!isUuid(messageId)) throw new NotFoundError('CareMessage');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const message = await tx.careMessage.findFirst({
      where: { tenantId: ctx.tenantId, id: messageId, subscriptionId },
      select: {
        id: true,
        subscription: { select: { number: true } },
        photo: { select: { id: true, storageKey: true, thumbKey: true, removedAt: true } },
      },
    });
    if (!message) return { kind: 'missing' } as const;
    const photo = message.photo;
    if (!photo || photo.removedAt) return { kind: 'already' } as const;
    await tx.carePhoto.update({
      where: { id: photo.id, tenantId: ctx.tenantId },
      data: { removedAt: new Date(), removedById: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careMessagePhotoRemoved,
      entityType: 'CareMessage',
      entityId: message.id,
      metadata: {
        number: formatSubscriptionNumber(message.subscription.number),
        photoId: photo.id,
      },
    });
    return { kind: 'removed', photo } as const;
  });
  if (result.kind === 'missing') return notFound(ctx, 'CareMessage', messageId);
  if (result.kind === 'already') return;
  if (await deleteCarePhotoFiles(result.photo)) {
    await withTenantContext(getDb(), ctx, (tx) =>
      tx.carePhoto.updateMany({
        where: { tenantId: ctx.tenantId, id: result.photo.id, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }
}

/** La foto di un messaggio del contratto (`thumb` = miniatura), finché si vede. */
export async function getCareMessagePhotoImage(
  ctx: TenantContext,
  subscriptionId: string,
  photoId: string,
  variant: PhotoVariant,
): Promise<StoredImage> {
  requirePermission(ctx, 'care:messages');
  if (!isUuid(subscriptionId) || !isUuid(photoId)) throw new NotFoundError('CarePhoto');
  const photo = await withTenantContext(getDb(), ctx, (tx) =>
    tx.carePhoto.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: photoId,
        subscriptionId,
        messageId: { not: null },
        removedAt: null,
        deletedAt: null,
      },
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return notFound(ctx, 'CarePhoto', photoId);
  return readStoredImage(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'CarePhoto',
  );
}
