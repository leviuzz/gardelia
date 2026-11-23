import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  addCatalogItemToOrder,
  addOrderPhoto,
  changeOrderStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  getOrder,
  getOrderPhotoImage,
  getPublicOrder,
  getPublicOrderPhoto,
  setObjectStorage,
  setOrderReceiver,
  sharePublicLink,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/** Prova di consegna (ADR-058): foto del ramo finito e chi l'ha ricevuto. */

const db = getDb();
const storage = new MemoryStorage();
const SECRET = 'test-secret-for-handover-0123456789';
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;

async function photo(color: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 800, height: 900, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

/** Ordine confermato al ritiro, domani. */
async function pickupOrder() {
  const parts = todayInTimeZone(shop.owner.timezone);
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
    .toISOString()
    .slice(0, 10);
  const { id } = await createDraftOrder(shop.owner, { customerId });
  await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '6' });
  await confirmDraftOrder(shop.owner, id, {
    fulfillmentMode: 'PICKUP',
    scheduledDate: tomorrow,
    windowStart: '',
    windowEnd: '',
    customerAddressId: '',
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '',
    cardSignature: '',
    deliveryFee: '',
    notes: '',
  });
  return id;
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Entrega');
  other = await createTestShop('Florería Entrega Ajena');
  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' }));
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Ana Torres',
      legalName: null,
      taxId: null,
      email: null,
      phone: null,
      notes: null,
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: null,
      marketingConsent: false,
    })
  ).id;
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('prova di consegna', () => {
  it('foto da "pronto" in poi, chi riceve dopo il ritiro; il cliente le vede dal link', async () => {
    const id = await pickupOrder();
    // Prima di "pronto" la foto non si carica; prima del ritiro il nome non si registra.
    await expect(addOrderPhoto(shop.staff, id, await photo('#c33'))).rejects.toMatchObject({
      reason: 'order_not_ready',
    });
    await changeOrderStatus(shop.staff, id, 'READY');
    await expect(setOrderReceiver(shop.staff, id, { receivedBy: 'Ana' })).rejects.toMatchObject({
      reason: 'order_not_handed_over',
    });

    const first = await addOrderPhoto(shop.staff, id, await photo('#c33'));
    const second = await addOrderPhoto(shop.staff, id, await photo('#3c3'));
    expect(second.id).not.toBe(first.id);
    let order = await getOrder(shop.owner, id);
    expect(order.handover.photo?.id).toBe(second.id);
    expect(order.handover.canAddPhoto).toBe(true);
    expect(order.handover.canSetReceiver).toBe(false);
    expect((await getOrderPhotoImage(shop.staff, id, 'thumb')).bytes.length).toBeGreaterThan(0);

    await changeOrderStatus(shop.staff, id, 'PICKED_UP');
    await setOrderReceiver(shop.staff, id, { receivedBy: '  Ana Torres  ' });
    order = await getOrder(shop.owner, id);
    expect(order.handover).toMatchObject({ receivedBy: 'Ana Torres', canSetReceiver: true });

    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'ORDER', id });
    expect(await getPublicOrder(SECRET, link.token)).toMatchObject({
      receivedBy: 'Ana Torres',
      photoId: second.id,
    });
    expect((await getPublicOrderPhoto(SECRET, link.token, 'full'))?.bytes.length).toBeGreaterThan(
      0,
    );

    // Il nome non finisce nel registro di audit.
    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: id, action: { in: ['order.photo_added', 'order.receiver_recorded'] } },
      }),
    );
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain('Ana Torres');

    await setOrderReceiver(shop.staff, id, { receivedBy: '' });
    expect((await getOrder(shop.owner, id)).handover.receivedBy).toBeNull();
  });

  it('valida il nome e il file', async () => {
    const id = await pickupOrder();
    await changeOrderStatus(shop.staff, id, 'READY');
    await expect(addOrderPhoto(shop.staff, id, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await changeOrderStatus(shop.staff, id, 'PICKED_UP');
    await expect(
      setOrderReceiver(shop.staff, id, { receivedBy: 'x'.repeat(200) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('il database: una sola foto attiva per ordine', async () => {
    const id = await pickupOrder();
    await changeOrderStatus(shop.staff, id, 'READY');
    await addOrderPhoto(shop.staff, id, await photo('#33c'));
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.orderPhoto.create({
          data: {
            tenantId: shop.tenant.tenantId,
            orderId: id,
            storageKey: 'x',
            thumbKey: 'y',
            contentType: 'image/jpeg',
            width: 1,
            height: 1,
            sizeBytes: 1,
            createdById: shop.owner.userId,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('isolamento', () => {
  it('un’altra fioreria non carica né vede la foto altrui', async () => {
    const id = await pickupOrder();
    await changeOrderStatus(shop.staff, id, 'READY');
    await addOrderPhoto(shop.staff, id, await photo('#c3c'));
    await expect(addOrderPhoto(other.owner, id, await photo('#000'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getOrderPhotoImage(other.owner, id, 'full')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setOrderReceiver(other.owner, id, { receivedBy: 'Intruso' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const visible = await withTenantContext(db, other.owner, (tx) =>
      tx.orderPhoto.findMany({ where: { orderId: id } }),
    );
    expect(visible).toEqual([]);
  });

  it('serve il permesso di far avanzare gli ordini', async () => {
    const id = await pickupOrder();
    await expect(
      addOrderPhoto({ ...shop.staff, role: 'NONE' } as never, id, await photo('#fff')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
