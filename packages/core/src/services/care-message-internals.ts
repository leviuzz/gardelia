/**
 * Pezzi comuni dei messaggi di Floral Care (ADR-084) usati anche dall'invio delle email: senza
 * dipendenze dai servizi, così `care-visit-work.ts` li usa senza giri di import.
 */
import type { TransactionClient } from '@floral/db';

/** La pagina del contratto in Mi Floral Care: `/cuenta/floral-care/<contratto>`. */
export function myCareContractUrl(appUrl: string, subscriptionId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/cuenta/floral-care/${subscriptionId}`;
}

/**
 * Chi riceve l'avviso dei messaggi: le persone con un accesso attivo a questo contratto (solo a
 * questo o a tutti quelli del cliente), un indirizzo ciascuna. Più la sede, per il testo.
 */
export async function portalRecipientsTx(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<{ readonly emails: readonly string[]; readonly place: string | null } | null> {
  const contract = await tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId },
    select: {
      customerId: true,
      customerAddress: { select: { label: true, addressLine1: true } },
    },
  });
  if (!contract) return null;
  const accesses = await tx.carePortalAccess.findMany({
    where: {
      tenantId,
      customerId: contract.customerId,
      revokedAt: null,
      OR: [{ subscriptionId }, { subscriptionId: null }],
    },
    select: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const emails = [...new Set(accesses.map((access) => access.user.email.trim().toLowerCase()))];
  const address = contract.customerAddress;
  return { emails, place: address ? (address.label ?? address.addressLine1) : null };
}

/** Quante persone vedono il contratto in Mi Floral Care (accessi attivi). */
export async function portalAccessCountTx(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  customerId: string,
): Promise<number> {
  return tx.carePortalAccess.count({
    where: {
      tenantId,
      customerId,
      revokedAt: null,
      OR: [{ subscriptionId }, { subscriptionId: null }],
    },
  });
}

/** Gli indirizzi di proprietari e gerenti attivi della fioreria (avvisi interni). */
export async function shopManagerEmailsTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<readonly string[]> {
  const members = await tx.membership.findMany({
    where: { tenantId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(members.map((member) => member.user.email))];
}
