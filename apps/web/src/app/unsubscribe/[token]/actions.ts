'use server';

/**
 * Conferma della disiscrizione dalle promozioni (ADR-047). Pagina pubblica, senza sessione: il
 * link arriva dal client (legato con .bind()) e lo verifica il core (firma HMAC); fioreria e
 * cliente vengono solo dal link verificato.
 */
import { redirect } from 'next/navigation';
import { unsubscribeFromPromotions } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { getRequestMeta } from '@/lib/request-meta';

export async function unsubscribeAction(token: string): Promise<void> {
  await unsubscribeFromPromotions(serverEnv().BETTER_AUTH_SECRET, token, await getRequestMeta());
  // Stessa pagina, che ora mostra la conferma (funziona anche senza JavaScript).
  redirect(`/unsubscribe/${encodeURIComponent(token)}`);
}
