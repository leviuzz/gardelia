import 'server-only';
import { getMailer, type OrderMailDeps } from '@floral/core';
import { serverEnv } from './env';
import { accountRoutes, buyerRoutes, tenantRoutes } from './routes';

/**
 * Cosa serve al core per scrivere le email degli ordini online (ADR-067): il mailer, la firma dei
 * link di tracciamento e gli indirizzi assoluti dell'app, costruiti con le rotte del web.
 */
export function orderMailDeps(): OrderMailDeps {
  const env = serverEnv();
  const base = env.APP_URL.replace(/\/+$/, '');
  return {
    mailer: getMailer(),
    appUrl: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    links: {
      order: (tenantSlug, orderId) => `${base}${tenantRoutes(tenantSlug).orders.detail(orderId)}`,
      account: `${base}${accountRoutes.home}`,
      search: `${base}${buyerRoutes.home}`,
      careMessages: (tenantSlug) => `${base}${tenantRoutes(tenantSlug).subscriptions.messages()}`,
      // M3: la pagina dell'ordine nel conto di chi compra, dove si risponde.
      buyerOrder: (orderId) => `${base}${accountRoutes.orders.detail(orderId)}`,
      // M5: la richiesta di un servizio nell'app della fioreria e nel conto di chi compra.
      serviceRequest: (tenantSlug, requestId) =>
        `${base}${tenantRoutes(tenantSlug).requests.detail(requestId)}`,
      buyerServiceRequest: (requestId) => `${base}${accountRoutes.requests.detail(requestId)}`,
    },
  };
}
