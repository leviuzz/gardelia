import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { addDays, dayOfWeek, toIsoDate, todayInTimeZone, type CalendarDate } from '@floral/domain';
import {
  ConflictError,
  MemoryMailer,
  NotFoundError,
  acceptOnlineOrder,
  addDeliveryWindow,
  cancelMarketplaceOrder,
  createCatalogItem,
  getOrder,
  listBuyerOrders,
  placeMarketplaceOrder,
  setOnlineStorePublished,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateTenantProfile,
  type BuyerContext,
  type CatalogItemDto,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Chi compra annulla da solo un ordine online ancora "Por aceptar" (resti degli ordini, ADR-067):
 * solo i propri, solo prima dell'accettazione; email a lui e alla fioreria.
 */

const db = getDb();
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const mailer = new MemoryMailer();
const deps: OrderMailDeps = {
  mailer,
  appUrl: 'http://localhost:3000',
  secret: SECRET,
  links: {
    order: (slug, id) => `http://localhost:3000/app/${slug}/orders/${id}`,
    account: 'http://localhost:3000/cuenta',
    search: 'http://localhost:3000/',
  },
};

let shop: TestShop;
let bouquet: CatalogItemDto;
let ana: BuyerContext & { email: string };
let beto: BuyerContext & { email: string };

/** Il primo giorno ordinabile che non è domenica (chiusura della fioreria di prova). */
function openDay(): CalendarDate {
  let day = addDays(todayInTimeZone('America/Mexico_City'), 1);
  while (dayOfWeek(day) === 0) day = addDays(day, 1);
  return day;
}

async function buyer(name: string) {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX' as const, email: user.email };
}

async function place(who: BuyerContext) {
  return placeMarketplaceOrder(
    who,
    shop.tenant.slug,
    {
      [`qty.${bouquet.id}`]: '1',
      fulfillmentMode: 'PICKUP',
      scheduledDate: toIsoDate(openDay()),
      window: '09:00-12:00',
      cardMessage: '',
      cardSignature: '',
      contactPhone: '449 555 0101',
    },
    { fromSearch: false },
    deps,
  );
}

beforeAll(async () => {
  shop = await createTestShop('Florería Cancela');
  await updateTenantProfile(shop.owner, {
    displayName: 'Florería Cancela',
    contactEmail: `contacto-${shop.tenant.slug}@example.com`,
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      isOnline: true,
      name: 'Ramo Cancelable',
      priceMinor: 50000,
    }),
  );
  await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '0' });
  await addDeliveryWindow(shop.owner, { start: '09:00', end: '12:00' });
  await setOnlineStorePublished(shop.owner, true);
  await updateOnlineStore(shop.owner, {
    description: '',
    paymentMethods: ['CASH'],
    paymentInstructions: '',
  });
  await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
  ana = await buyer('Ana Cancela');
  beto = await buyer('Beto Ajeno');
});

afterAll(async () => {
  await disconnectDb();
});

describe('chi compra annulla un ordine in attesa', () => {
  it('lo annulla con il motivo, la fioreria lo vede e riceve l’avviso', async () => {
    const placed = await place(ana);
    mailer.sent.length = 0;
    await cancelMarketplaceOrder(ana, placed.orderId, deps);

    const order = await getOrder(shop.owner, placed.orderId);
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'El cliente canceló el pedido antes de que la florería lo aceptara.',
    });
    expect(
      (await listBuyerOrders(ana, SECRET)).find((row) => row.orderId === placed.orderId),
    ).toMatchObject({ status: 'CANCELLED' });

    const toBuyer = mailer.lastTo(ana.email);
    expect(toBuyer).toMatchObject({ category: 'online_order_cancelled' });
    expect(toBuyer?.subject).toContain('Cancelaste tu pedido');
    const toOwner = mailer.lastTo(shop.tenant.owner.email);
    expect(toOwner).toMatchObject({ category: 'online_order_withdrawn' });
    expect(toOwner?.text).toContain(`/orders/${placed.orderId}`);
    expect(mailer.lastTo(shop.managerUser.email)).toBeDefined();
    expect(mailer.lastTo(shop.staffUser.email)).toBeUndefined();

    const audit = await withSystemContext(db, { reason: 'test: annullato da chi compra' }, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: shop.tenant.tenantId, entityId: placed.orderId },
        orderBy: { createdAt: 'desc' },
        select: { action: true, actorUserId: true },
      }),
    );
    expect(audit).toEqual({ action: 'order.cancelled_by_buyer', actorUserId: ana.userId });

    // Una seconda volta non cambia nulla.
    await expect(cancelMarketplaceOrder(ana, placed.orderId, deps)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('dopo l’accettazione non si annulla più da "Mis pedidos"', async () => {
    const placed = await place(ana);
    await acceptOnlineOrder(shop.owner, placed.orderId, null);
    await expect(cancelMarketplaceOrder(ana, placed.orderId, null)).rejects.toMatchObject({
      reason: 'order_not_pending',
    });
    expect((await getOrder(shop.owner, placed.orderId)).status).toBe('CONFIRMED');
  });

  it('l’ordine di un’altra persona non si trova: 404 e nessuna modifica', async () => {
    const placed = await place(ana);
    await expect(cancelMarketplaceOrder(beto, placed.orderId, null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(cancelMarketplaceOrder(beto, 'no-uuid', null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getOrder(shop.owner, placed.orderId)).status).toBe('PENDING_ACCEPTANCE');
  });
});
