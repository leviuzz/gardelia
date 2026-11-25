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
  /** Dati della fioreria scaricati dal titolare (ADR-079): solo i conteggi nei metadati. */
  tenantDataExported: 'tenant.data_exported',
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
  /** Un ingrediente di un ramo cambiato con un sostituto (ADR-081). */
  orderIngredientSubstituted: 'order.ingredient_substituted',
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
  /** Crediti dell'Asistente de plantas comprati dalla fioreria (ADR-085, blocco 6b). */
  assistantCreditsGranted: 'ai_credits.assistant_granted',
  /** La fioreria è stata cancellata davvero (evento di piattaforma, senza dati personali). */
  platformTenantPurged: 'platform.tenant_purged',
  securityTenantAccessDenied: 'security.tenant_access_denied',
  /** Sicurezza del conto (ADR-077): verifica in due passaggi e sessioni. Solo ID, mai codici. */
  securityTwoFactorEnabled: 'security.two_factor_enabled',
  securityTwoFactorDisabled: 'security.two_factor_disabled',
  securityBackupCodesRegenerated: 'security.backup_codes_regenerated',
  securitySessionRevoked: 'security.session_revoked',
  securityOtherSessionsRevoked: 'security.other_sessions_revoked',
  securityCrossTenantAccess: 'security.cross_tenant_access_attempt',
  platformAdminBootstrapped: 'platform.admin_bootstrapped',
  /** Email confermata a mano dall'amministratore (senza email di conferma, ADR-050). */
  platformUserEmailConfirmed: 'platform.user_email_confirmed',
  /** Chi compra ha eliminato il suo conto cliente (diritto di cancellazione, ADR-068). */
  platformBuyerAccountDeleted: 'platform.buyer_account_deleted',
  /** Verifica in due passaggi tolta dall'amministratore a chi ha perso telefono e codici (ADR-077). */
  platformTwoFactorReset: 'platform.two_factor_reset',
  /** Persona aggiunta al team dall'amministratore della piattaforma (ADR-050). */
  memberAddedByPlatform: 'member.added_by_platform',
  /** Floral Care (ADR-075): offerta, servizi, fasce, contratti, piante e visite. */
  careSettingsUpdated: 'care.settings_updated',
  careServiceCreated: 'care.service_created',
  careServiceUpdated: 'care.service_updated',
  careServiceArchived: 'care.service_archived',
  careTravelTierAdded: 'care.travel_tier_added',
  careTravelTierRemoved: 'care.travel_tier_removed',
  careSlotCreated: 'care.slot_created',
  careSlotUpdated: 'care.slot_updated',
  careSlotArchived: 'care.slot_archived',
  carePlantAdded: 'care.plant_added',
  carePlantUpdated: 'care.plant_updated',
  carePlantRemoved: 'care.plant_removed',
  careVisitsGenerated: 'care.visits_generated',
  careVisitDone: 'care.visit_done',
  careVisitNotDone: 'care.visit_not_done',
  careVisitAssigned: 'care.visit_assigned',
  careVisitMoved: 'care.visit_moved',
  careVisitCancelled: 'care.visit_cancelled',
  /** La visita dal telefono (ADR-078): iniziata, una foto tolta, avvisi per chi gestisce. */
  careVisitStarted: 'care.visit_started',
  careVisitPhotoRemoved: 'care.visit_photo_removed',
  careFollowUpCreated: 'care.follow_up_created',
  careFollowUpResolved: 'care.follow_up_resolved',
  /** Il lavoro giornaliero ha cancellato le foto di un contratto finito da 30 giorni. */
  carePhotosDeleted: 'care.photos_deleted',
  /** Blocco 2b (ADR-078): visita extra, cotización dal contratto, piante di temporada al ritiro. */
  careExtraVisitCreated: 'care.extra_visit_created',
  careQuoteCreated: 'care.quote_created',
  careSeasonalPlantsArchived: 'care.seasonal_plants_archived',
  /**
   * Cargos e pagamenti dei contratti (ADR-082). Nei metadati numeri e importi, mai la referencia,
   * la nota o i nomi.
   */
  careChargeIssued: 'care.charge_issued',
  carePaymentRecorded: 'care.payment_recorded',
  carePaymentReversed: 'care.payment_reversed',
  carePaymentRefunded: 'care.payment_refunded',
  /**
   * Blocco 3b: l'incasso segnato alla visita ("por registrar"), confermato o rifiutato, e gli
   * ajustes per il cargo dopo. Mai la nota, il motivo del rifiuto o quello dell'ajuste.
   */
  carePaymentSubmitted: 'care.payment_submitted',
  carePaymentConfirmed: 'care.payment_confirmed',
  carePaymentRejected: 'care.payment_rejected',
  careAdjustmentAdded: 'care.adjustment_added',
  careAdjustmentRemoved: 'care.adjustment_removed',
  /** Blocco 4 (ADR-083): giorni bloccati, visite spostate o cancellate insieme, persona cambiata. */
  careBlockCreated: 'care.block_created',
  careBlockRemoved: 'care.block_removed',
  careVisitsReassigned: 'care.visits_reassigned',
  /**
   * Blocco 5a (ADR-084): la pagina del cliente. Invito, accesso dato o tolto, data cambiata dal
   * cliente (attore = la persona, `source: 'portal'`). Mai l'email nei metadati.
   */
  carePortalInvited: 'care.portal_invited',
  carePortalInviteRevoked: 'care.portal_invite_revoked',
  carePortalAccessGranted: 'care.portal_access_granted',
  carePortalAccessRevoked: 'care.portal_access_revoked',
  careVisitMovedByCustomer: 'care.visit_moved_by_customer',
  /** Blocco 5b (ADR-084): la fioreria toglie la foto di un messaggio (il file si cancella). */
  careMessagePhotoRemoved: 'care.message_photo_removed',
  /**
   * Asistente de plantas (ADR-085, blocco 6b): la fioreria dà crediti a un contratto (costano soldi
   * alla fioreria). Le consultas del cliente non vanno nel registro della fioreria: i testi sono
   * suoi, la fioreria vede solo quante.
   */
  careAssistantCreditsGiven: 'care.assistant_credits_given',
  /**
   * Contratti con i clienti (CustomerSubscription): `customer_subscription.*`, da non confondere con
   * `subscription.assigned`, il piano della fioreria su Gardelia.
   */
  subscriptionCreated: 'customer_subscription.created',
  subscriptionUpdated: 'customer_subscription.updated',
  subscriptionConfirmed: 'customer_subscription.confirmed',
  subscriptionScheduleChanged: 'customer_subscription.schedule_changed',
  subscriptionEnded: 'customer_subscription.ended',
  /** Prezzo ricalcolato su piante, servizi e tariffe attuali (nuova versione del prezzo). */
  subscriptionRepriced: 'customer_subscription.repriced',
  /** Bozza mai confermata messa da parte. */
  subscriptionDiscarded: 'customer_subscription.discarded',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
