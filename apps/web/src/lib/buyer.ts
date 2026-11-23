import 'server-only';
import type { BuyerContext } from '@floral/core';
import type { ActionState } from './action-state';
import { accountRoutes } from './routes';
import { requireUser } from './session';
import { nextOutcomeDeps, settleAction, type ActionOutcome } from './tenant-action';

/**
 * Contesto del conto cliente (blocco C1): l'utente viene SOLO dalla sessione, mai dal browser.
 * Senza sessione si va al login e poi si torna qui.
 */
export async function getBuyerContext(next: string = accountRoutes.home): Promise<BuyerContext> {
  const user = await requireUser(next);
  // V1: indirizzi solo in Messico (primo mercato, D-02).
  return { userId: user.id, country: 'MX' };
}

export type BuyerActionWork = (scope: { readonly ctx: BuyerContext }) => Promise<ActionOutcome>;

/**
 * Ossatura delle server action di "Mi cuenta", gemella di `runTenantAction`: contesto dalla
 * sessione PRIMA di tutto, errori del servizio → stato del form, poi ricarica e messaggio.
 */
export async function runBuyerAction(work: BuyerActionWork): Promise<ActionState> {
  const ctx = await getBuyerContext();
  return settleAction(nextOutcomeDeps, () => work({ ctx }));
}
