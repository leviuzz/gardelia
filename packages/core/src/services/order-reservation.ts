/**
 * Apartados dagli ordini confermati (ADR-072, sull'API degli apartados di ADR-062). Un ordine
 * confermato tiene i suoi materiali (gli stessi che usciranno a "Listo", ADR-071) con un apartado
 * che il servizio degli ordini tiene allineato a ogni cambio: nasce alla conferma, segue righe e
 * giorno, si usa a "Listo" e si libera se l'ordine si annulla. Tiene la merce solo negli ultimi
 * `ORDER_HOLD_DAYS` giorni prima della consegna: un ordine preso con mesi di anticipo non blocca la
 * merce fresca di oggi.
 *
 * Un ordine non si blocca mai per l'inventario: se la merce non basta l'apartado si fa lo stesso
 * (si vede nel disponibile e negli avvisi), e un ordine fuori dai limiti dell'inventario va avanti
 * senza apartado (nel log). Le funzioni vanno chiamate nella transazione che ha bloccato l'ordine.
 */
import type { TransactionClient } from '@floral/db';
import { formatOrderNumber, orderHoldWindow, todayInTimeZone } from '@floral/domain';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';
import { logger } from '../logger';
import {
  releaseReservationTx,
  reserveStockTx,
  updateReservationHoldTx,
} from './inventory-reservations';
import { orderStockRequest } from './order-inventory';
import { dateToParts } from './quote-internals';

/** L'apartado ancora attivo dell'ordine (ID), o null. */
export async function activeOrderReservationId(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
): Promise<string | null> {
  const order = await tx.order.findFirst({
    where: { tenantId: ctx.tenantId, id: orderId },
    select: { inventoryReservationId: true, inventoryReservation: { select: { status: true } } },
  });
  return order?.inventoryReservation?.status === 'ACTIVE' ? order.inventoryReservationId : null;
}

/**
 * Allinea l'apartado dell'ordine al suo stato attuale: lo crea, lo aggiorna (righe e date) o lo
 * libera. Idempotente: chiamarla due volte non cambia nulla.
 */
export async function syncOrderReservationTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findFirst({
    where: { tenantId: ctx.tenantId, id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      scheduledDate: true,
      inventoryEntryId: true,
      inventoryReservationId: true,
      inventoryReservation: { select: { status: true } },
    },
  });
  if (!order) return;
  const active =
    order.inventoryReservation?.status === 'ACTIVE' ? order.inventoryReservationId : null;
  const window = orderHoldWindow(
    {
      status: order.status,
      scheduledDate: dateToParts(order.scheduledDate),
      consumed: order.inventoryEntryId !== null,
    },
    todayInTimeZone(ctx.timezone),
  );
  if (!window) {
    if (active) await releaseReservationTx(tx, ctx, active);
    return;
  }
  try {
    const lines = await orderStockRequest(tx, ctx.tenantId, order.id);
    if (active) {
      await updateReservationHoldTx(tx, ctx, active, { lines, ...window });
      return;
    }
    if (lines.length === 0) return;
    const created = await reserveStockTx(tx, ctx, {
      // Il numero dell'ordine, come la nota del registro di uso (ADR-071): niente dati del cliente.
      label: formatOrderNumber(order.number),
      expiresOn: window.expiresOn,
      holdsFrom: window.holdsFrom,
      lines,
      confirmShortage: true,
    });
    if (created.reservationId) {
      await tx.order.update({
        where: { id: order.id, tenantId: ctx.tenantId },
        data: { inventoryReservationId: created.reservationId },
      });
    }
  } catch (error) {
    // Quantità fuori dai limiti dell'inventario (un ordine enorme): l'errore nasce prima di
    // scrivere, quindi la transazione è sana. L'ordine va avanti senza apartado, come lo scarico.
    if (error instanceof ValidationError) {
      logger.warn({ orderId: order.id }, "apartado dell'ordine non aggiornato: fuori dai limiti");
      if (active) await releaseReservationTx(tx, ctx, active);
      return;
    }
    throw error;
  }
}
