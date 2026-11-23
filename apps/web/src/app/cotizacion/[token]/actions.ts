'use server';

/**
 * "Aceptar cotización" dal link pubblico (ADR-056). Pagina senza sessione: il token arriva dal
 * client (legato con .bind()) e lo verifica il core (firma, link attivo); la fioreria e il
 * preventivo vengono solo dal link verificato. Si accetta solo con un clic (POST): l'anteprima
 * automatica di un link in WhatsApp non accetta nulla.
 */
import { redirect } from 'next/navigation';
import { acceptPublicQuote } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { getRequestMeta } from '@/lib/request-meta';

export async function acceptQuoteAction(token: string): Promise<void> {
  await acceptPublicQuote(serverEnv().BETTER_AUTH_SECRET, token, await getRequestMeta());
  // Stessa pagina, che ora mostra l'esito (funziona anche senza JavaScript).
  redirect(`/cotizacion/${encodeURIComponent(token)}`);
}
