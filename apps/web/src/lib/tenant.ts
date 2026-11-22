import 'server-only';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { resolveTenantContext, type TenantContext } from '@floral/core';
import { getRequestMeta } from './request-meta';
import { tenantRoutes } from './routes';
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
  return ctx;
});
