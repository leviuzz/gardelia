/**
 * Documenti legali e diritti di chi compra (marketplace, blocco C5, ADR-068). I testi vivono in
 * `docs/legal/` (bozze finché non li rivede un avvocato messicano); qui solo le regole pure.
 */

/**
 * Versione dei documenti legali mostrati nell'app: si registra con gli ordini online (prova di
 * cosa ha accettato chi compra). Si cambia a ogni nuova versione pubblicata dei testi.
 */
export const LEGAL_VERSION = '2026-11-23-borrador';

/** Cosa impedisce a una persona di eliminare da sola il suo conto cliente. */
export type BuyerAccountDeletionBlocker =
  /** Fa parte di una fioreria: il conto regge anche dati della fioreria (si passa dal supporto). */
  | 'shop_member'
  /** Amministrazione della piattaforma. */
  | 'platform_role'
  /** Ha ordini ancora da accettare o da consegnare: la fioreria deve poterla avvisare. */
  | 'orders_in_progress';

const FINAL_ORDER_STATUSES = new Set(['DELIVERED', 'PICKED_UP', 'CANCELLED']);

export function buyerAccountDeletionBlockers(input: {
  readonly memberships: number;
  readonly platformRole: string;
  readonly orderStatuses: readonly string[];
}): BuyerAccountDeletionBlocker[] {
  const blockers: BuyerAccountDeletionBlocker[] = [];
  if (input.memberships > 0) blockers.push('shop_member');
  if (input.platformRole !== 'NONE') blockers.push('platform_role');
  if (input.orderStatuses.some((status) => !FINAL_ORDER_STATUSES.has(status))) {
    blockers.push('orders_in_progress');
  }
  return blockers;
}
