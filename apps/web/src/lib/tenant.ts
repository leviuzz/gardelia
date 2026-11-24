import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { getTwoFactorRequirement, resolveTenantContext, type TenantContext } from '@floral/core';
import { getRequestMeta } from './request-meta';
import { securityRoutes, tenantRoutes } from './routes';
import { requireUser } from './session';

/**
 * Contesto della fioreria per lo slug dell'URL. Da chiamare in OGNI pagina e server action
 * sotto /app/[tenantSlug]: il layout non protegge le server action (endpoint POST autonomi).
 * Se l'utente non è membro attivo risponde 404 (non 403), senza rivelare se lo slug esiste.
 */
export const getTenantContext = cache(async (slug: string): Promise<TenantContext> => {
  const user = await requireUser(tenantRoutes(slug).home);
  const ctx = await resolveTenantContext({
    userId: user.id,
    slug,
    request: await getRequestMeta(),
    // Lingua dell'interfaccia (ADR-042): i dati localizzati (es. nomi dei fiori) la seguono.
    locale: await getLocale(),
  });
  if (!ctx) notFound();
  // Verifica in due passaggi obbligatoria per i titolari (ADR-077): passata la scadenza, nessuna
  // pagina né azione della fioreria finché non la attivano.
  if (ctx.role === 'OWNER' && (await getTwoFactorStatus(user.id)).blocking) {
    redirect(securityRoutes.home({ requerida: true, volver: tenantRoutes(slug).home }));
  }
  return ctx;
});

/** Stato della verifica in due passaggi della persona, una volta per richiesta. */
export const getTwoFactorStatus = cache((userId: string) => getTwoFactorRequirement(userId));
