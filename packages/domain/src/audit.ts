/**
 * Supporto al registro di audit: calcolo delle differenze fra stato precedente e successivo
 * (spec §4.2: "le modifiche critiche registrano autore, timestamp e diff").
 */

export interface FieldChange {
  readonly from: unknown;
  readonly to: unknown;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Restituisce solo i campi effettivamente cambiati, fra quelli elencati. */
export function diffFields<T extends object>(
  before: T,
  after: Partial<T>,
  keys: readonly (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (!isEqual(from, to)) changes[key] = { from: normalize(from), to: normalize(to) };
  }
  return changes;
}

/** Azioni registrate nell'audit log (stringhe stabili: usate anche dalla UI "attività recente"). */
export const AUDIT_ACTIONS = {
  tenantCreated: 'tenant.created',
  tenantUpdated: 'tenant.updated',
  tenantPromoUpdated: 'tenant.promo_updated',
  /** Eliminazione programmata e annullata (ADR-074). */
  tenantDeletionRequested: 'tenant.deletion_requested',
  tenantDeletionCancelled: 'tenant.deletion_cancelled',
  locationUpdated: 'location.updated',
  deliverySettingsUpdated: 'delivery_settings.updated',
  deliveryWindowAdded: 'delivery_window.added',
  deliveryWindowRemoved: 'delivery_window.removed',
  /** Costo di consegna per distanza (ADR-069). */
  deliveryFeeTierAdded: 'delivery_fee_tier.added',
  deliveryFeeTierRemoved: 'delivery_fee_tier.removed',
  memberInvited: 'member.invited',
  invitationRevoked: 'invitation.revoked',
  invitationAccepted: 'invitation.accepted',
  memberRoleChanged: 'member.role_changed',
  memberDeactivated: 'member.deactivated',
  memberReactivated: 'member.reactivated',
  catalogItemCreated: 'catalog_item.created',
  catalogItemUpdated: 'catalog_item.updated',
  catalogItemArchived: 'catalog_item.archived',
  catalogItemRestored: 'catalog_item.restored',
  catalogPhotoAdded: 'catalog_item.photo_added',
  catalogPhotoArchived: 'catalog_item.photo_archived',
  recipeUpdated: 'recipe.updated',
  recipeLineAdded: 'recipe.line_added',
  recipeLineUpdated: 'recipe.line_updated',
  recipeLineRemoved: 'recipe.line_removed',
  customerCreated: 'customer.created',
  customerUpdated: 'customer.updated',
  customerArchived: 'customer.archived',
  customerRestored: 'customer.restored',
  /** Un'etichetta aggiunta o tolta a più clienti insieme (ADR-070). */
  customerTagsAdded: 'customer.tags_added',
  customerTagsRemoved: 'customer.tags_removed',
  /** Clienti importati da un file CSV (ADR-070): una voce per import, con i soli conti. */
  customersImported: 'customer.imported',
  customerAddressAdded: 'customer.address_added',
  customerAddressUpdated: 'customer.address_updated',
  customerAddressArchived: 'customer.address_archived',
  customerOccasionAdded: 'customer.occasion_added',
  customerOccasionRemoved: 'customer.occasion_removed',
  /** Il cliente ha tolto il consenso alle promozioni dal link dell'email. */
  customerUnsubscribed: 'customer.unsubscribed',
  /** Sconto della promo segnato come usato, o tolto il segno (ADR-048). */
  promoRedeemed: 'promo.redeemed',
  promoRedemptionUndone: 'promo.redemption_undone',
  quoteCreated: 'quote.created',
  quoteUpdated: 'quote.updated',
  quoteLineAdded: 'quote.line_added',
  quoteLineUpdated: 'quote.line_updated',
  quoteLineRemoved: 'quote.line_removed',
  quoteStatusChanged: 'quote.status_changed',
  /** Accettato dal cliente con il link pubblico (ADR-056), senza utente. */
  quoteAcceptedOnline: 'quote.accepted_online',
  publicLinkCreated: 'public_link.created',
  publicLinkRevoked: 'public_link.revoked',
  orderCreated: 'order.created',
  orderUpdated: 'order.updated',
  orderLineAdded: 'order.line_added',
  orderLineUpdated: 'order.line_updated',
  orderLineRemoved: 'order.line_removed',
  orderConfirmed: 'order.confirmed',
  orderDiscarded: 'order.discarded',
  orderDiscountChanged: 'order.discount_changed',
  orderAssigned: 'order.assigned',
  orderPhotoAdded: 'order.photo_added',
  orderReceiverRecorded: 'order.receiver_recorded',
  orderStatusChanged: 'order.status_changed',
  orderCancelled: 'order.cancelled',
  /** Ordine del cliente dalla tienda en línea (ADR-067): fatto, accettato, scaduto senza risposta. */
  orderPlacedOnline: 'order.placed_online',
  orderAccepted: 'order.accepted',
  orderExpired: 'order.expired',
  /** Chi compra annulla da "Mis pedidos" un ordine online ancora da accettare. */
  orderCancelledByBuyer: 'order.cancelled_by_buyer',
  orderPaymentRecorded: 'order.payment_recorded',
  orderPaymentReversed: 'order.payment_reversed',
  subscriptionAssigned: 'subscription.assigned',
  /** "Mi tienda en línea" (ADR-065). */
  storeUpdated: 'store.updated',
  storePublished: 'store.published',
  storeUnpublished: 'store.unpublished',
  storeImageSet: 'store.image_set',
  storeImageRemoved: 'store.image_removed',
  storeOrdersUpdated: 'store.orders_updated',
  /** Inventario (ADR-060): prodotti controllati e registri di magazzino. */
  inventoryTrackingStarted: 'inventory.tracking_started',
  inventoryTrackingStopped: 'inventory.tracking_stopped',
  inventoryItemUpdated: 'inventory.item_updated',
  inventoryStockUsed: 'inventory.stock_used',
  inventoryStockWasted: 'inventory.stock_wasted',
  inventoryStockCounted: 'inventory.stock_counted',
  inventoryEntryReversed: 'inventory.entry_reversed',
  /** Compras e proveedores (ADR-061). */
  inventoryPurchaseRecorded: 'inventory.purchase_recorded',
  inventorySupplierCreated: 'inventory.supplier_created',
  inventorySupplierUpdated: 'inventory.supplier_updated',
  inventorySupplierArchived: 'inventory.supplier_archived',
  inventorySupplierRestored: 'inventory.supplier_restored',
  /** Il costo reale (medio) usato come costo del catalogo, con un clic. */
  inventoryRealCostApplied: 'inventory.real_cost_applied',
  /** Apartados con vencimiento (ADR-062). */
  inventoryReservationCreated: 'inventory.reservation_created',
  inventoryReservationExtended: 'inventory.reservation_extended',
  inventoryReservationReleased: 'inventory.reservation_released',
  inventoryReservationUsed: 'inventory.reservation_used',
  /** Un ordine confermato ha cambiato righe o giorno: il suo apartado lo segue (ADR-072). */
  inventoryReservationUpdated: 'inventory.reservation_updated',
  /** "Registrar ramos hechos" (ADR-063): la ricetta × N esce dall'inventario. */
  inventoryBouquetsMade: 'inventory.bouquets_made',
  builderConfigurationCreated: 'builder.configuration_created',
  builderConfigurationUpdated: 'builder.configuration_updated',
  builderConfigurationArchived: 'builder.configuration_archived',
  builderConfigurationRestored: 'builder.configuration_restored',
  builderConfigurationDeleted: 'builder.configuration_deleted',
  /** Foto vera del ramo caricata o tolta da un disegno (ADR-052). */
  builderPhotoAdded: 'builder.photo_added',
  builderPhotoRemoved: 'builder.photo_removed',
  aiPreviewRequested: 'ai.preview_requested',
  styleReferenceAdded: 'builder.style_reference_added',
  styleReferenceArchived: 'builder.style_reference_archived',
  aiCreditsGranted: 'ai_credits.granted',
  /** La fioreria è stata cancellata davvero (evento di piattaforma, senza dati personali). */
  platformTenantPurged: 'platform.tenant_purged',
  securityTenantAccessDenied: 'security.tenant_access_denied',
  securityCrossTenantAccess: 'security.cross_tenant_access_attempt',
  platformAdminBootstrapped: 'platform.admin_bootstrapped',
  /** Email confermata a mano dall'amministratore (senza email di conferma, ADR-050). */
  platformUserEmailConfirmed: 'platform.user_email_confirmed',
  /** Chi compra ha eliminato il suo conto cliente (diritto di cancellazione, ADR-068). */
  platformBuyerAccountDeleted: 'platform.buyer_account_deleted',
  /** Persona aggiunta al team dall'amministratore della piattaforma (ADR-050). */
  memberAddedByPlatform: 'member.added_by_platform',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
