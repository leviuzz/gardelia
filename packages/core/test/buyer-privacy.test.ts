import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { addTestMember, createTestUser } from '@floral/db/testing';
import { addDays, dayOfWeek, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  MemoryMailer,
  addBuyerAddress,
  cancelOrder,
  createCatalogItem,
  exportBuyerData,
  getBuyerAccountDeletionBlockers,
  getOrder,
  placeMarketplaceOrder,
  recordBuyerAccountDeleted,
  setOnlineStorePublished,
  updateBuyerProfile,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateTenantProfile,
  type BuyerContext,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Diritti di chi compra (blocco C5, ADR-068): scaricare i propri dati e cancellare il conto.
 * Ognuno vede solo i suoi dati; la cancellazione toglie i dati della persona ma non gli ordini
 * delle fiorerie, che restano senza il collegamento al conto.
 */

const db = getDb();
const deps: OrderMailDeps = {
  mailer: new MemoryMailer(),
  appUrl: 'http://localhost:3000',
  secret: 'segreto-di-prova-per-i-link-pubblici-0123456789',
  links: {
    order: (slug, id) => `http://localhost:3000/app/${slug}/orders/${id}`,
    account: 'http://localhost:3000/cuenta',
    search: 'http://localhost:3000/',
  },
};
let shop: TestShop;
let ana: BuyerContext & { email: string };
let beto: BuyerContext & { email: string };
let itemId: string;

function nextOpenDay(): string {
  let day = addDays(todayInTimeZone('America/Mexico_City'), 1);
  while (dayOfWeek(day) === 0) day = addDays(day, 1);
  return toIsoDate(day);
}

function pickupOrder() {
  return {
    [`qty.${itemId}`]: '1',
    fulfillmentMode: 'PICKUP',
    scheduledDate: nextOpenDay(),
    window: '',
    contactPhone: '449 555 0101',
  };
}

/** L'ordine di Ana (il test guarda tutte le fiorerie: contesto di sistema, solo nei test). */
async function anaOrderId(): Promise<string> {
  const order = await withSystemContext(db, { reason: 'test: ordine di chi compra' }, (tx) =>
    tx.order.findFirstOrThrow({ where: { buyerUserId: ana.userId }, select: { id: true } }),
  );
  return order.id;
}

async function buyer(name: string) {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX' as const, email: user.email };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Privacidad');
  await updateTenantProfile(shop.owner, {
    displayName: 'Florería Privacidad',
    contactEmail: '',
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
  const item = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 50000,
      isOnline: true,
    }),
  );
  itemId = item.id;
  await updateOnlineStore(shop.owner, {
    description: '',
    paymentMethods: ['CASH'],
    paymentInstructions: '',
  });
  await setOnlineStorePublished(shop.owner, true);
  await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
  ana = await buyer('Ana Privada');
  beto = await buyer('Beto Privado');
});

afterAll(async () => {
  await disconnectDb();
});

describe('"Descargar mis datos"', () => {
  it('conto, indirizzi (anche quelli tolti) e ordini; solo della persona', async () => {
    await updateBuyerProfile(ana, { phone: '449 555 0101' });
    await addBuyerAddress(ana, {
      label: 'Casa',
      addressLine1: 'Av. Madero 120',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
    });
    await addBuyerAddress(beto, {
      addressLine1: 'Calle de Beto 1',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
    });
    await placeMarketplaceOrder(ana, shop.tenant.slug, pickupOrder(), { fromSearch: false }, deps);

    const data = await exportBuyerData(ana);
    expect(data.account).toMatchObject({
      name: 'Ana Privada',
      email: ana.email,
      phone: '+524495550101',
    });
    expect(data.addresses.map((address) => address.addressLine1)).toEqual(['Av. Madero 120']);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({
      shop: 'Florería Privacidad',
      status: 'PENDING_ACCEPTANCE',
      mode: 'PICKUP',
      totalMinor: 50000,
    });
    const all = JSON.stringify(data);
    expect(all).not.toContain('Calle de Beto');
    expect(all).not.toContain(beto.email);
    // Niente identificativi interni né dati della fioreria oltre al nome.
    expect(all).not.toContain(shop.tenant.tenantId);
    expect(all).not.toContain(ana.userId);
  });
});

describe('eliminare il conto', () => {
  it('bloccato con un ordine in corso, libero quando è chiuso', async () => {
    expect(await getBuyerAccountDeletionBlockers(ana)).toEqual(['orders_in_progress']);
    const [order] = (await exportBuyerData(ana)).orders;
    expect(order).toBeDefined();
    await cancelOrder(shop.owner, await anaOrderId(), { reason: 'Sin flores' });
    expect(await getBuyerAccountDeletionBlockers(ana)).toEqual([]);
  });

  it('chi fa parte di una fioreria passa dal supporto', async () => {
    const member = await addTestMember(db, shop.tenant.tenantId, 'STAFF');
    expect(await getBuyerAccountDeletionBlockers({ userId: member.id })).toEqual(['shop_member']);
  });

  it('cancella i dati della persona; gli ordini restano alla fioreria senza il collegamento', async () => {
    const orderId = await anaOrderId();
    // Come fa Better Auth: il ruolo dell'app, senza contesto.
    await db.user.delete({ where: { id: ana.userId } });
    await recordBuyerAccountDeleted(ana.userId);

    const left = await withSystemContext(db, { reason: 'test: verifica cancellazione' }, (tx) =>
      Promise.all([
        tx.buyerProfile.count({ where: { userId: ana.userId } }),
        tx.buyerAddress.count({ where: { userId: ana.userId } }),
        tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { buyerUserId: true, placedOnline: true },
        }),
        tx.auditLog.findFirst({
          where: { action: 'platform.buyer_account_deleted', entityId: ana.userId },
          select: { tenantId: true, metadata: true },
        }),
      ]),
    );
    expect(left[0]).toBe(0);
    expect(left[1]).toBe(0);
    expect(left[2]).toEqual({ buyerUserId: null, placedOnline: true });
    expect(left[3]).toMatchObject({ tenantId: null });
    // La fioreria vede ancora il suo ordine e il suo cliente.
    const order = await getOrder(shop.owner, orderId);
    expect(order.customer.email).toBe(ana.email.toLowerCase());
    // Gli indirizzi di Beto non sono stati toccati.
    expect((await exportBuyerData(beto)).addresses).toHaveLength(1);
  });
});
