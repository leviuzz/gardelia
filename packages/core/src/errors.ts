/**
 * Errori applicativi tipizzati. I servizi lanciano solo questi (o errori inattesi);
 * il livello web li traduce in risposte/messaggi senza esporre dettagli interni.
 */
import type { FieldErrors } from '@floral/domain';

export abstract class AppError extends Error {
  abstract readonly code: 'not_found' | 'forbidden' | 'validation' | 'conflict';
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
  | 'invalid_status_transition';

export class ConflictError extends AppError {
  readonly code = 'conflict' as const;
  constructor(readonly reason: ConflictReason) {
    super(`Conflitto: ${reason}`);
    this.name = 'ConflictError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
