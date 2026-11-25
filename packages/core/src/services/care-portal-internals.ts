/**
 * Floral Care, pagina del cliente (ADR-084): le chiusure di inviti e accessi che fanno altri
 * servizi (fine del contratto, cliente archiviato). Qui niente import pesanti: le usano i
 * contratti, i clienti e i lavori.
 */
import type { TransactionClient } from '@floral/db';

/** Un contratto finito: i suoi inviti in attesa non si possono più accettare. */
export async function revokeContractPortalInvitesTx(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<number> {
  const result = await tx.carePortalInvite.updateMany({
    where: { tenantId, subscriptionId, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Cliente archiviato: si chiudono i suoi accessi e i suoi inviti in attesa. Le righe si bloccano
 * in ordine di id, dopo il cliente: lo stesso ordine dell'accettazione di un invito.
 */
export async function closeCustomerPortalTx(
  tx: TransactionClient,
  tenantId: string,
  customerId: string,
  revokedById: string | null,
): Promise<{ readonly accesses: number; readonly invites: number }> {
  await tx.$queryRaw`SELECT "id" FROM "CarePortalAccess"
    WHERE "tenantId" = ${tenantId}::uuid AND "customerId" = ${customerId}::uuid
      AND "revokedAt" IS NULL
    ORDER BY "id" FOR UPDATE`;
  const now = new Date();
  const accesses = await tx.carePortalAccess.updateMany({
    where: { tenantId, customerId, revokedAt: null },
    data: { revokedAt: now, revokedReason: 'CUSTOMER_ARCHIVED', revokedById },
  });
  const invites = await tx.carePortalInvite.updateMany({
    where: { tenantId, customerId, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: now, revokedById },
  });
  return { accesses: accesses.count, invites: invites.count };
}
