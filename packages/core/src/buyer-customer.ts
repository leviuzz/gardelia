/**
 * Il cliente del CRM della fioreria per chi compra dal marketplace (ordini online, ADR-067;
 * richieste dei servizi, M5): quello con la stessa email, o uno nuovo con il canale «online_store».
 * Il telefono di chi compra si scrive sul cliente che non ne aveva uno (M0); quello che il fiorista
 * ha già salvato non si tocca. Da chiamare nel contesto della fioreria, sotto il lock del giro.
 */
import type { TransactionClient } from '@floral/db';

export interface BuyerCustomerLink {
  readonly customerId: string;
  /** Origine (fee D-24): portato da Gardelia solo dalla ricerca e se non era già un cliente. */
  readonly acquisitionSource: 'MARKETPLACE_B2C' | 'MERCHANT_DIRECT';
  /** Il telefono di chi compra è stato aggiunto a un cliente che non ne aveva. */
  readonly phoneAdded: boolean;
  /** Il cliente è nuovo (non c'era nessuno con quell'email). */
  readonly created: boolean;
}

export async function linkBuyerCustomerTx(
  tx: TransactionClient,
  input: {
    readonly tenantId: string;
    readonly user: { readonly name: string; readonly email: string };
    readonly contactPhone: string;
    readonly fromSearch: boolean;
  },
): Promise<BuyerCustomerLink> {
  const { tenantId, user } = input;
  const existing = await tx.customer.findFirst({
    where: { tenantId, status: 'ACTIVE', email: { equals: user.email, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, acquisitionSource: true, phone: true },
  });
  const acquisitionSource =
    input.fromSearch && (!existing || existing.acquisitionSource === 'MARKETPLACE_B2C')
      ? 'MARKETPLACE_B2C'
      : 'MERCHANT_DIRECT';
  const customer =
    existing ??
    (await tx.customer.create({
      data: {
        tenantId,
        type: 'PERSON',
        displayName: user.name,
        email: user.email.toLowerCase(),
        phone: input.contactPhone,
        acquisitionSource,
        acquisitionChannel: 'online_store',
      },
      select: { id: true },
    }));
  const phoneAdded = existing !== null && !existing.phone;
  if (phoneAdded) {
    await tx.customer.update({
      where: { id: existing.id, tenantId },
      data: { phone: input.contactPhone },
    });
  }
  return { customerId: customer.id, acquisitionSource, phoneAdded, created: existing === null };
}
