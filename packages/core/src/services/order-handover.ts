/**
 * Prova di consegna (ADR-058, blocco B2): la foto del ramo finito (da "pronto" in poi) e il nome di
 * chi l'ha ricevuto (dopo la consegna o il ritiro). Le registra chi fa avanzare gli ordini
 * (`orders:fulfill`, anche lo staff e il repartidor). La foto la vedono la fioreria e il cliente dal
 * suo link; i file sono privati sotto `tenants/{tenantId}/order-photos/`.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  acceptsOrderPhoto,
  formatOrderNumber,
  isOrderHandedOver,
  isUuid,
  newId,
  orderHandoverSchema,
  toFieldErrors,
  type OrderStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit, type StoredImage } from '../media/stored-files';
import type { PhotoVariant } from './catalog-photos';

/** Foto del ramo finito: carica o cambia quella dell'ordine (la precedente si archivia). */
export async function addOrderPhoto(
  ctx: TenantContext,
  orderId: string,
  file: Uint8Array,
): Promise<{ id: string }> {
  requirePermission(ctx, 'orders:fulfill');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const image = await normalizeUploadedPhoto(file);
  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/order-photos/${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/order-photos/${id}-thumb.jpg`;
  // File salvati PRIMA della transazione (che resta breve) e cancellati se non va a buon fine.
  const saved = await storeFilesThenCommit(
    [
      { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    () =>
      withTenantContext(getDb(), ctx, async (tx) => {
        const [order] = await tx.$queryRaw<{ id: string; number: number; status: OrderStatus }[]>`
          SELECT "id", "number", "status" FROM "Order"
          WHERE "id" = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
        if (!order) return null;
        if (!acceptsOrderPhoto(order.status)) throw new ConflictError('order_not_ready');
        const replaced = await tx.orderPhoto.updateMany({
          where: { tenantId: ctx.tenantId, orderId: order.id, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
        await tx.orderPhoto.create({
          data: {
            id,
            tenantId: ctx.tenantId,
            orderId: order.id,
            storageKey,
            thumbKey,
            contentType: image.full.contentType,
            width: image.full.width,
            height: image.full.height,
            sizeBytes: image.full.bytes.byteLength,
            createdById: ctx.userId,
          },
        });
        await recordAudit(tx, ctx, {
          action: AUDIT_ACTIONS.orderPhotoAdded,
          entityType: 'Order',
          entityId: order.id,
          metadata: { number: formatOrderNumber(order.number), replaced: replaced.count > 0 },
        });
        return { id };
      }),
  );
  if (!saved) return notFound(ctx, 'Order', orderId);
  return saved;
}

/** Chi ha ricevuto il ramo; vuoto lo toglie. Nel registro non va il nome (dato personale). */
export async function setOrderReceiver(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:fulfill');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = orderHandoverSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const receivedBy = parsed.data.receivedBy;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      select: { id: true, number: true, status: true, handoverName: true },
    });
    if (!order) return false;
    if (!isOrderHandedOver(order.status)) throw new ConflictError('order_not_handed_over');
    if (order.handoverName === receivedBy) return true;
    await tx.order.update({ where: { id: order.id }, data: { handoverName: receivedBy } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderReceiverRecorded,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), recorded: receivedBy !== null },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

/** La foto attiva del ramo finito (`thumb` = miniatura). */
export async function getOrderPhotoImage(
  ctx: TenantContext,
  orderId: string,
  variant: PhotoVariant,
): Promise<StoredImage> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const photo = await withTenantContext(getDb(), ctx, (tx) =>
    tx.orderPhoto.findFirst({
      where: { tenantId: ctx.tenantId, orderId, status: 'ACTIVE' },
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return notFound(ctx, 'Order', orderId);
  return readStoredImage(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'OrderPhoto',
  );
}
