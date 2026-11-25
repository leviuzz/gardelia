import 'server-only';
import { notFound } from 'next/navigation';
import { NotFoundError, getMailer, type CarePortalDeps, type MyCareChangeDeps } from '@floral/core';
import { serverEnv } from './env';
import { tenantRoutes } from './routes';

/**
 * Cosa serve al core per la pagina del cliente di Floral Care (ADR-084): il mailer, la firma dei
 * link (la stessa dei link pubblici, ADR-056) e gli indirizzi assoluti costruiti con le rotte del
 * web.
 */
export function carePortalDeps(): CarePortalDeps {
  const env = serverEnv();
  return { mailer: getMailer(), appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET };
}

/** "Cambiar fecha": l'email alla fioreria porta alla visita nella sua Agenda. */
export function careChangeDeps(): MyCareChangeDeps {
  const base = serverEnv().APP_URL.replace(/\/+$/, '');
  return {
    mailer: getMailer(),
    visitUrl: (tenantSlug, visitId) => `${base}${tenantRoutes(tenantSlug).agenda.visit(visitId)}`,
  };
}

/** Il segreto dei link firmati, per leggere un invito. */
export function carePortalSecret(): string {
  return serverEnv().BETTER_AUTH_SECRET;
}

/** Un contratto, una visita o un cargo che la persona non vede: la pagina risponde 404. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
