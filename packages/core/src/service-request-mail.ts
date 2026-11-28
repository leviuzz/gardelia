/**
 * Email delle richieste di servizi della vetrina (M5, ADR-089), nella lingua del mercato (ADR-042):
 * a chi compra (ricevuta, la fioreria non può) e a proprietari e gerenti (nuova, annullata da chi
 * l'ha fatta). Come per gli ordini online, i dati si raccolgono DENTRO la transazione e l'invio
 * avviene DOPO il commit (`sendOrderMails`), senza mai far fallire l'operazione. Mai il messaggio di
 * chi compra né l'indirizzo intero: si leggono nell'app.
 */
import type { TransactionClient } from '@floral/db';
import {
  formatServiceRequestNumber,
  storefrontServiceDisplayName,
  type StorefrontServiceKind,
} from '@floral/domain';
import {
  newServiceRequestShopEmail,
  serviceRequestCancelledShopEmail,
  serviceRequestDeclinedEmail,
  serviceRequestReceivedEmail,
  type ServiceRequestEmailFacts,
} from './email-templates';
import type { EmailMessage } from './mailer';
import { buyerNameTx, managerEmailsTx, type OrderMailDeps } from './order-mail';

const LOCALE = 'es-MX';

async function requestFactsTx(tx: TransactionClient, tenantId: string, requestId: string) {
  const [request, tenant] = await Promise.all([
    tx.serviceRequest.findFirst({
      where: { tenantId, id: requestId },
      select: {
        id: true,
        number: true,
        kind: true,
        buyerUserId: true,
        preferredDate: true,
        neighborhood: true,
        city: true,
        declineReason: true,
        service: { select: { kind: true, name: true } },
      },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true, contactEmail: true },
    }),
  ]);
  if (!request) return null;
  const facts: ServiceRequestEmailFacts = {
    shopName: tenant.displayName,
    numberLabel: formatServiceRequestNumber(request.number),
    serviceName: storefrontServiceDisplayName({
      kind: request.service.kind as StorefrontServiceKind,
      name: request.service.name,
    }),
  };
  return { request, tenant, facts };
}

/** La pagina della richiesta nel conto di chi compra, o «Mi cuenta» se il web non la passa. */
function buyerRequestUrl(requestId: string, deps: OrderMailDeps): string {
  return deps.links.buyerServiceRequest?.(requestId) ?? deps.links.account;
}

function shopRequestUrl(tenantSlug: string, requestId: string, deps: OrderMailDeps): string {
  return deps.links.serviceRequest?.(tenantSlug, requestId) ?? deps.appUrl;
}

/** «sábado 20 de diciembre» (la data è un giorno del calendario, senza ora). */
function dateLabel(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/** L'email per chi ha fatto la richiesta, o null se ha eliminato il conto. */
export async function buyerServiceRequestMailTx(
  tx: TransactionClient,
  tenantId: string,
  requestId: string,
  kind: 'received' | 'declined',
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const found = await requestFactsTx(tx, tenantId, requestId);
  if (!found?.request.buyerUserId) return null;
  const buyer = await tx.user.findUnique({
    where: { id: found.request.buyerUserId },
    select: { name: true, email: true },
  });
  if (!buyer) return null;
  const common = {
    to: buyer.email,
    name: buyer.name,
    facts: found.facts,
    url: buyerRequestUrl(requestId, deps),
    replyTo: found.tenant.contactEmail,
  };
  if (kind === 'received') return serviceRequestReceivedEmail(common);
  if (!found.request.declineReason) return null;
  return serviceRequestDeclinedEmail({ ...common, reason: found.request.declineReason });
}

/** Le email per proprietari e gerenti attivi: una richiesta nuova o annullata da chi l'ha fatta. */
export async function shopServiceRequestMailsTx(
  tx: TransactionClient,
  tenantId: string,
  requestId: string,
  kind: 'new' | 'cancelled',
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const found = await requestFactsTx(tx, tenantId, requestId);
  if (!found) return [];
  const [emails, buyerName] = await Promise.all([
    managerEmailsTx(tx, tenantId),
    buyerNameTx(tx, found.request.buyerUserId),
  ]);
  const url = shopRequestUrl(found.tenant.slug, requestId, deps);
  return emails.map((to) =>
    kind === 'new'
      ? newServiceRequestShopEmail({
          to,
          buyerName,
          facts: found.facts,
          dateLabel: dateLabel(found.request.preferredDate),
          zone: [found.request.neighborhood, found.request.city].filter(Boolean).join(', ') || null,
          url,
        })
      : serviceRequestCancelledShopEmail({ to, buyerName, facts: found.facts, url }),
  );
}
