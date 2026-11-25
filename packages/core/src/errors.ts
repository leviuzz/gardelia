/**
 * Errori applicativi tipizzati. I servizi lanciano solo questi (o errori inattesi);
 * il livello web li traduce in risposte/messaggi senza esporre dettagli interni.
 */
import type { FeatureEntitlement, FieldErrors } from '@floral/domain';

export abstract class AppError extends Error {
  abstract readonly code: 'not_found' | 'forbidden' | 'validation' | 'conflict' | 'plan_required';
}

/** Risorsa inesistente O appartenente a un altro tenant (indistinguibili per chi chiama). */
export class NotFoundError extends AppError {
  readonly code = 'not_found' as const;
  constructor(readonly entity: string) {
    super(`${entity} non trovato`);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'forbidden' as const;
  constructor(readonly reason: string) {
    super(`Operazione non consentita: ${reason}`);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  readonly code = 'validation' as const;
  constructor(readonly fieldErrors: FieldErrors) {
    super('Dati non validi');
    this.name = 'ValidationError';
  }
}

export type ConflictReason =
  | 'sku_taken'
  | 'last_owner'
  | 'already_member'
  | 'ingredient_already_in_recipe'
  | 'recipe_line_limit'
  | 'not_a_bouquet'
  | 'self_change'
  | 'invitation_not_pending'
  | 'invitation_expired'
  | 'tenant_limit_reached'
  | 'slug_unavailable'
  | 'occasion_limit'
  | 'quote_not_editable'
  | 'quote_line_limit'
  | 'quote_empty'
  | 'invalid_status_transition'
  | 'builder_configuration_archived'
  | 'builder_configuration_outdated'
  | 'builder_configuration_in_use'
  | 'ai_preview_in_progress'
  | 'ai_unavailable'
  | 'ai_quota_exhausted'
  | 'ai_budget_reached'
  | 'cutout_unavailable'
  | 'cutout_retry_limit'
  | 'preview_retry_limit'
  | 'promo_not_sent'
  | 'promo_already_used'
  | 'platform_admin_exists'
  | 'quote_not_accepted'
  | 'quote_already_ordered'
  | 'order_not_editable'
  | 'order_closed'
  | 'payment_already_reversed'
  | 'order_not_confirmed'
  | 'order_empty'
  | 'order_lines_locked'
  | 'order_line_limit'
  | 'order_total_below_paid'
  | 'delivery_window_exists'
  | 'delivery_window_limit'
  /** Costo per distanza (ADR-069): stessa distanza già presente, troppe fasce. */
  | 'delivery_fee_tier_exists'
  | 'delivery_fee_tier_limit'
  | 'public_link_unavailable'
  | 'order_not_delivery'
  | 'order_not_ready'
  | 'order_not_handed_over'
  | 'inventory_insufficient_stock'
  | 'inventory_item_archived'
  | 'inventory_already_tracked'
  | 'inventory_entry_not_reversible'
  | 'inventory_entry_already_reversed'
  | 'inventory_no_real_cost'
  /** Apartado già usato o liberato (ADR-062). */
  | 'inventory_reservation_closed'
  /** Apartado di un ordine (ADR-072): lo usa e lo libera l'ordine, non la scheda dell'apartado. */
  | 'inventory_reservation_order'
  /** "Registrar ramos hechos" su un ramo senza ricetta (ADR-063). */
  | 'inventory_bouquet_without_recipe'
  /** Import di clienti da CSV (ADR-070): bozza già importata o annullata; niente di nuovo da importare. */
  | 'customers_import_closed'
  | 'customers_import_nothing'
  /** "Mi tienda en línea" (ADR-065): cosa manca per pubblicare. */
  | 'store_needs_items'
  | 'store_needs_contact'
  /** Ordini online (ADR-067): per riceverli serve un modo di pagare. */
  | 'store_needs_payment'
  /** Chi compra: la tienda non riceve ordini, o ne ha già troppi in attesa da questa persona. */
  | 'checkout_closed'
  | 'checkout_pending_limit'
  /** La fioreria: l'ordine online non è (più) da accettare, o il suo giorno è già passato. */
  | 'order_not_pending'
  | 'order_date_passed'
  /** Un ordine "Por aceptar" si conferma solo con "Aceptar pedido" (che lo scrive al cliente). */
  | 'order_needs_acceptance'
  /** "Listo": i materiali dell'ordine non bastano nell'inventario (ADR-071). */
  | 'order_inventory_shortage'
  /** Sostituto (ADR-081): il ramo è già fatto o il pedido è chiuso; il ramo non ammette cambi. */
  | 'order_not_substitutable'
  | 'substitution_not_allowed'
  /** Floral Care (ADR-075): l'offerta non è ancora salvata. */
  | 'care_not_configured'
  /** Servizi, fasce e fasce di distanza: troppi, o uguali a uno che c'è già. */
  | 'care_service_limit'
  | 'care_service_exists'
  | 'care_slot_limit'
  | 'care_slot_exists'
  /** Il giorno di una fascia con contratti o visite non si cambia: se ne crea un'altra. */
  | 'care_slot_in_use'
  | 'care_travel_tier_exists'
  | 'care_travel_tier_limit'
  /** Il contratto non è nello stato giusto per questo passo (bozza, attivo, finito). */
  | 'care_contract_not_editable'
  /** Cliente archiviato: niente contratti nuovi. */
  | 'care_customer_archived'
  /** Conferma: servono piante, e fasce e frequenza ancora offerte. */
  | 'care_no_plants'
  | 'care_schedule_outdated'
  /** Sede oltre il raggio: il fiorista deve dire che va lo stesso. */
  | 'care_out_of_range'
  | 'care_plant_limit'
  /** Visite: fascia senza posto, visita già chiusa, visita di un giorno che non è arrivato. */
  | 'care_slot_full'
  | 'care_visit_closed'
  | 'care_visit_future'
  /** La visita dal telefono (ADR-078): i passi si registrano solo a visita in corso. */
  | 'care_visit_not_in_progress'
  /** "Terminar visita": ogni pianta deve avere il suo stato ("Todas bien" lo fa in un tocco). */
  | 'care_plants_unmarked'
  /** "Terminar visita": i materiali non bastano nell'inventario (si conferma e si registra). */
  | 'care_visit_inventory_shortage'
  /** Troppe foto, materiali o avvisi in una visita. */
  | 'care_photo_limit'
  | 'care_material_limit'
  | 'care_follow_up_limit'
  /** La foto non si può più togliere da chi fa la visita (visita chiusa: solo chi gestisce). */
  | 'care_photo_locked'
  /** "Reintentar": l'email è già partita, o ha finito i tentativi, o non c'è niente da mandare. */
  | 'care_email_not_retryable'
  /** L'avviso è già stato risolto (da qualcun altro, o in un altro modo). */
  | 'care_follow_up_resolved'
  /**
   * Cargos (ADR-082): un movimento che non si annulla (è uno storno, o è "por registrar"), una
   * devolución su un cargo che non è a favore del cliente, un cargo con importi fuori misura.
   */
  | 'care_payment_not_reversible'
  | 'care_charge_not_in_favor'
  | 'care_charge_too_large'
  /**
   * Blocco 3b: la visita non è in corso né fatta (niente incasso), c'è già un incasso "por
   * registrar" per la visita, l'incasso è già stato confermato o rifiutato, l'ajuste è già in un
   * cargo, la visita mancata ha già la sua visita di recupero.
   */
  | 'care_collection_not_open'
  | 'care_collection_pending'
  | 'care_payment_not_pending'
  | 'care_adjustment_in_charge'
  | 'care_visit_already_recovered'
  /**
   * Blocco 4 (ADR-083): le visite toccate sono cambiate dopo l'anteprima (si rivede), troppe
   * visite in un blocco solo, troppi blocchi attivi.
   */
  | 'care_block_changed'
  | 'care_block_too_many_visits'
  | 'care_block_limit'
  /**
   * Blocco 5a (ADR-084), la pagina del cliente: contratto non aperto, cliente archiviato, troppi
   * inviti o persone, invito già usato o revocato, scaduto, per un'altra email; dal portale, una
   * visita che non si può più cambiare.
   */
  | 'care_portal_contract_not_open'
  | 'care_portal_customer_archived'
  | 'care_portal_invite_limit'
  | 'care_portal_invite_not_pending'
  | 'care_portal_invite_expired'
  | 'care_portal_email_mismatch'
  | 'care_portal_move_not_allowed'
  | 'care_portal_move_notice'
  /**
   * Messaggi di Floral Care (ADR-084): il contratto non è più attivo né in pausa; troppi messaggi
   * oggi dalla stessa persona sullo stesso contratto.
   */
  | 'care_message_closed'
  | 'care_message_daily_limit'
  // Asistente de plantas (ADR-085): testi in `assistant.conflict.*`.
  | 'assistant_unavailable'
  | 'assistant_daily_limit'
  | 'assistant_budget_reached'
  | 'assistant_photo_unusable'
  | 'assistant_case_full'
  | 'assistant_failed'
  /** "Eliminar florería" con ordini ancora da consegnare o ritirare (ADR-074). */
  | 'tenant_deletion_open_orders'
  | 'session_is_current';

export class ConflictError extends AppError {
  readonly code = 'conflict' as const;
  constructor(readonly reason: ConflictReason) {
    super(`Conflitto: ${reason}`);
    this.name = 'ConflictError';
  }
}

/**
 * La funzione non è inclusa nel piano della fioreria [BILL-01]. Distinto da ForbiddenError:
 * il ruolo è sufficiente, manca il piano (la UI propone l'upgrade invece di un divieto).
 */
export class PlanRequiredError extends AppError {
  readonly code = 'plan_required' as const;
  constructor(readonly feature: FeatureEntitlement) {
    super(`Funzione non inclusa nel piano: ${feature}`);
    this.name = 'PlanRequiredError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
