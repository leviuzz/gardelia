'use server';

/**
 * Server action dell'inventario (ADR-060): il servizio di @floral/core valida l'input e
 * ricontrolla permessi, piano e fioreria. Contesto, errori e messaggi: `runTenantAction`.
 * Gli ID e i tipi legati con .bind() arrivano dal client: non sono affidabili (il servizio li
 * cerca solo nella fioreria del contesto e rifiuta i valori sconosciuti).
 */
import {
  applyRealCostToCatalog,
  consumeReservation,
  createReservation,
  createSupplier,
  extendReservation,
  recordBouquetsMade,
  recordPurchase,
  recordStockCount,
  recordStockOut,
  releaseReservation,
  reverseInventoryEntry,
  setCatalogItemAvailability,
  setSupplierArchived,
  startInventoryTracking,
  stopInventoryTracking,
  updateInventoryItemSettings,
  updateSupplier,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section } from '@/lib/tenant-action';

/** L'inventario (apartados compresi) e il catalogo (riquadro della scheda) mostrano le stesse giacenze. */
function stockPages(routes: TenantRoutes) {
  return [section(routes.inventory.list()), section(routes.catalog.list())];
}

/** "Elegir productos": avvia i prodotti con la quantità scritta e torna alle existencias. */
export async function startInventoryAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { started } = await startInventoryTracking(ctx, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      redirectTo: routes.inventory.list({ started: String(started) }),
    };
  });
}

/** Uso o merma (`kind`: USE | WASTE, verificato dal servizio). */
export async function recordStockOutAction(
  slug: string,
  inventoryItemId: string,
  kind: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await recordStockOut(ctx, inventoryItemId, kind, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      success: (t) =>
        t(kind === 'WASTE' ? 'inventory.forms.wasted' : 'inventory.forms.used', {
          quantity: t('inventory.quantity', { unit: result.saleUnit, count: result.onHand }),
        }),
    };
  });
}

export async function recordStockCountAction(
  slug: string,
  inventoryItemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await recordStockCount(ctx, inventoryItemId, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      success: (t) =>
        t(result.delta === 0 ? 'inventory.forms.countSame' : 'inventory.forms.countSaved', {
          quantity: t('inventory.quantity', { unit: result.saleUnit, count: result.onHand }),
        }),
    };
  });
}

export async function updateInventorySettingsAction(
  slug: string,
  inventoryItemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateInventoryItemSettings(ctx, inventoryItemId, formDataToObject(formData));
    return { revalidate: stockPages(routes), success: 'inventory.forms.minimumSaved' };
  });
}

export async function stopInventoryTrackingAction(
  slug: string,
  inventoryItemId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await stopInventoryTracking(ctx, inventoryItemId);
    return { revalidate: stockPages(routes), success: 'inventory.actions.stopped' };
  });
}

/** Anulación: la finestra di conferma, che mostra l'effetto, vale come conferma. */
export async function reverseInventoryEntryAction(
  slug: string,
  entryId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await reverseInventoryEntry(ctx, entryId, { confirmShortage: 'on' });
    return { revalidate: stockPages(routes), success: 'inventory.actions.reversed' };
  });
}

/** Il clic proposto dall'inventario: cambia solo la disponibilità nel catalogo. */
export async function setCatalogAvailabilityAction(
  slug: string,
  catalogItemId: string,
  availability: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCatalogItemAvailability(ctx, catalogItemId, availability);
    return {
      revalidate: [...stockPages(routes), section(routes.builder.list())],
      success: 'inventory.item.availabilityChanged',
    };
  });
}

/** "Nueva compra" (ADR-061): registra e apre la scheda della compra. */
export async function recordPurchaseAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { entryId } = await recordPurchase(ctx, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      redirectTo: routes.inventory.purchase(entryId, { created: true }),
    };
  });
}

/** "Usar este costo": il server legge il costo reale e lo porta nel catalogo. */
export async function applyRealCostAction(
  slug: string,
  inventoryItemId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await applyRealCostToCatalog(ctx, inventoryItemId);
    return { revalidate: stockPages(routes), success: 'inventory.item.realCostApplied' };
  });
}

export async function createSupplierAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await createSupplier(ctx, formDataToObject(formData));
    return {
      revalidate: section(routes.inventory.list()),
      success: 'inventory.suppliers.created',
    };
  });
}

export async function updateSupplierAction(
  slug: string,
  supplierId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateSupplier(ctx, supplierId, formDataToObject(formData));
    return { revalidate: section(routes.inventory.list()), success: 'inventory.suppliers.saved' };
  });
}

export async function setSupplierArchivedAction(
  slug: string,
  supplierId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setSupplierArchived(ctx, supplierId, archived === true);
    return {
      revalidate: section(routes.inventory.list()),
      success: archived ? 'inventory.suppliers.archivedDone' : 'inventory.suppliers.restoredDone',
    };
  });
}

/** "Nuevo apartado" (ADR-062): crea e apre la scheda dell'apartado. */
export async function createReservationAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { reservationId } = await createReservation(ctx, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      redirectTo: routes.inventory.reservation(reservationId, { created: true }),
    };
  });
}

/** "Usar": quanto si è usato davvero di ogni riga; la merce esce e l'apartado si chiude. */
export async function consumeReservationAction(
  slug: string,
  reservationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await consumeReservation(ctx, reservationId, formDataToObject(formData));
    return { revalidate: stockPages(routes), success: 'inventory.reservations.actions.used' };
  });
}

export async function extendReservationAction(
  slug: string,
  reservationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await extendReservation(ctx, reservationId, formDataToObject(formData));
    return { revalidate: stockPages(routes), success: 'inventory.reservations.actions.extended' };
  });
}

export async function releaseReservationAction(
  slug: string,
  reservationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await releaseReservation(ctx, reservationId);
    return { revalidate: stockPages(routes), success: 'inventory.reservations.actions.released' };
  });
}

/** "Registrar ramos hechos" (ADR-063): la ricetta × N esce dall'inventario. */
export async function recordBouquetsMadeAction(
  slug: string,
  bouquetId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await recordBouquetsMade(ctx, bouquetId, formDataToObject(formData));
    return {
      revalidate: stockPages(routes),
      success: (t) => t('inventory.bouquet.recorded', { count: result.count }),
    };
  });
}
