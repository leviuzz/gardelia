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
  | 'inventory_reservation_closed';

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
