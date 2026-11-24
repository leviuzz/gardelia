import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  addCatalogItemToOrder,
  addRecipeLine,
  changeOrderStatus,
  changeQuoteStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createOrderFromQuote,
  createQuoteFromConfiguration,
  getOrder,
  getOrderSubstitutions,
  saveBouquetConfiguration,
  setCatalogItemAvailability,
  startInventoryTracking,
  substituteOrderIngredient,
  updateRecipeDetails,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Sostituto quando manca un fiore (ADR-081): proposte simili e cambio secondo la regola del ramo
 * (no / chiedere al cliente / simile permesso; Diseñador = chiedere), prezzo invariato, distinta e
 * costo aggiornati, niente dopo lo scarico; ogni fioreria tocca solo i suoi pedidos (A↔B).
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let customerId: string;
let rosa: string;

let freedom: CatalogItemDto;
let explorer: CatalogItemDto;
let redCarnation: CatalogItemDto;
let pinkTulip: CatalogItemDto;
let soldOutRose: CatalogItemDto;
let roseBunch: CatalogItemDto;
let eucalyptus: CatalogItemDto;

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

function pickup(day = isoDate(2)) {
  return {
    fulfillmentMode: 'PICKUP',
    scheduledDate: day,
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
  };
}

async function bouquet(
  target: TestShop,
  name: string,
  policy: 'ASK_CUSTOMER' | 'SIMILAR_ALLOWED' | 'NOT_ALLOWED',
  ingredients: readonly { id: string; quantity: number }[],
): Promise<CatalogItemDto> {
  const item = await createCatalogItem(
    target.owner,
    itemInput({ name, type: 'BOUQUET', saleUnit: 'PIECE', variety: null, priceMinor: 69000 }),
  );
  for (const ingredient of ingredients) {
    await addRecipeLine(target.owner, item.id, {
      ingredientItemId: ingredient.id,
      quantity: ingredient.quantity,
    });
  }
  await updateRecipeDetails(target.owner, item.id, {
    laborCostMinor: 0,
    styleTags: [],
    notes: null,
    substitutionPolicy: policy,
  });
  return item;
}

async function orderOf(target: TestShop, customer: string, itemId: string, quantity = 1) {
  const { id } = await createDraftOrder(target.owner, { customerId: customer });
  await addCatalogItemToOrder(target.owner, id, {
    catalogItemId: itemId,
    quantity: String(quantity),
  });
  await confirmDraftOrder(target.owner, id, pickup());
  return id;
}

async function customerOf(target: TestShop, name: string): Promise<string> {
  return (
    await createCustomer(target.owner, {
      type: 'PERSON',
      displayName: name,
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
}

beforeAll(async () => {
  shop = await createTestShop('Florería Sustitutos');
  other = await createTestShop('Florería Sustitutos Ajena');
  rosa = (await db.canonicalFlower.findUniqueOrThrow({ where: { slug: 'rosa' } })).id;
  const flower = (name: string, overrides: Record<string, unknown> = {}) =>
    createCatalogItem(shop.owner, itemInput({ name, ...overrides }));
  freedom = await flower('Rosa', { variety: 'Freedom', canonicalFlowerId: rosa, costMinor: 1400 });
  explorer = await flower('Rosa', {
    variety: 'Explorer',
    canonicalFlowerId: rosa,
    priceMinor: 3800,
    costMinor: 1600,
  });
  redCarnation = await flower('Clavel', { variety: 'rojo', colors: ['red'], priceMinor: 1500 });
  pinkTulip = await flower('Tulipán', { variety: 'rosa', colors: ['pink'] });
  soldOutRose = await flower('Rosa', {
    variety: 'Vendela',
    canonicalFlowerId: rosa,
    availability: 'OUT_OF_STOCK',
  });
  roseBunch = await flower('Rosa en manojo', {
    canonicalFlowerId: rosa,
    saleUnit: 'BUNCH',
    variety: null,
  });
  eucalyptus = await flower('Eucalipto', {
    type: 'FOLIAGE',
    saleUnit: 'BUNCH',
    variety: 'baby blue',
    colors: ['green'],
  });
  customerId = await customerOf(shop, 'Cliente Sustituto');
});

afterAll(async () => {
  await disconnectDb();
});

describe('cosa manca e cosa si propone', () => {
  it('un fiore agotado: prima la stessa specie, poi lo stesso colore; mai agotados né altre unità', async () => {
    const classic = await bouquet(shop, 'Ramo Clásico', 'ASK_CUSTOMER', [
      { id: freedom.id, quantity: 12 },
      { id: eucalyptus.id, quantity: 1 },
    ]);
    const orderId = await orderOf(shop, customerId, classic.id, 2);
    expect(await getOrderSubstitutions(shop.owner, orderId)).toBeNull();

    await setCatalogItemAvailability(shop.owner, freedom.id, 'OUT_OF_STOCK');
    const view = await getOrderSubstitutions(shop.owner, orderId);
    expect(view?.canApply).toBe(true);
    expect(view?.lines).toHaveLength(1);
    const [line] = view!.lines;
    expect(line).toMatchObject({ mode: 'ASK_CUSTOMER', quantity: 2 });
    expect(line!.missing).toHaveLength(1);
    expect(line!.missing[0]).toMatchObject({
      catalogItemId: freedom.id,
      problem: 'OUT_OF_STOCK',
      quantity: 12,
      total: 24,
    });
    expect(line!.missing[0]!.candidates.map((c) => [c.name, c.variety, c.reason])).toEqual([
      ['Rosa', 'Explorer', 'SAME_SPECIES'],
      ['Clavel', 'rojo', 'SAME_COLOR'],
    ]);
    const ids = line!.missing[0]!.candidates.map((c) => c.id);
    expect(ids).not.toContain(pinkTulip.id);
    expect(ids).not.toContain(soldOutRose.id);
    expect(ids).not.toContain(roseBunch.id);
    await setCatalogItemAvailability(shop.owner, freedom.id, 'AVAILABLE');
  });

  it('la merce controllata che non basta: quanto manca, e sostituti solo con merce sufficiente', async () => {
    const kit = await createTestShop('Florería Sustitutos Inventario');
    const customer = await customerOf(kit, 'Cliente Inventario');
    const mk = (name: string, variety: string) =>
      createCatalogItem(kit.owner, itemInput({ name, variety, canonicalFlowerId: rosa }));
    const [short, plenty, little] = [
      await mk('Rosa', 'Freedom'),
      await mk('Rosa', 'Mondial'),
      await mk('Rosa', 'Playa Blanca'),
    ];
    const ramo = await bouquet(kit, 'Ramo inventario', 'SIMILAR_ALLOWED', [
      { id: short.id, quantity: 12 },
    ]);
    await startInventoryTracking(kit.owner, {
      rows: {
        '0': { catalogItemId: short.id, quantity: '5', minQuantity: '' },
        '1': { catalogItemId: plenty.id, quantity: '50', minQuantity: '' },
        '2': { catalogItemId: little.id, quantity: '3', minQuantity: '' },
      },
    });
    const orderId = await orderOf(kit, customer, ramo.id);
    const view = await getOrderSubstitutions(kit.owner, orderId);
    expect(view?.lines[0]?.mode).toBe('ALLOWED');
    expect(view?.lines[0]?.missing[0]).toMatchObject({ problem: 'SHORT', shortBy: 7 });
    expect(view?.lines[0]?.missing[0]?.candidates.map((c) => c.variety)).toEqual(['Mondial']);

    // "Similar permitido": si cambia subito, anche dallo staff, e l'apartado segue la distinta.
    await substituteOrderIngredient(kit.staff, orderId, {
      lineId: (await getOrder(kit.owner, orderId)).lines[0]!.id,
      fromItemId: short.id,
      toItemId: plenty.id,
    });
    expect(await getOrderSubstitutions(kit.owner, orderId)).toBeNull();
    const held = await withTenantContext(db, kit.owner, async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { tenantId: kit.owner.tenantId, id: orderId },
        select: { inventoryReservationId: true },
      });
      return tx.inventoryReservationLine.findMany({
        where: { tenantId: kit.owner.tenantId, reservationId: order.inventoryReservationId! },
        select: { item: { select: { catalogItemId: true } }, quantity: true },
      });
    });
    expect(held).toEqual([{ item: { catalogItemId: plenty.id }, quantity: 12 }]);
  });
});

describe('il cambio', () => {
  it('"Preguntar al cliente": serve l’ok; poi cambia la distinta, il costo e non il prezzo', async () => {
    const ramo = await bouquet(shop, 'Ramo preguntar', 'ASK_CUSTOMER', [
      { id: freedom.id, quantity: 12 },
    ]);
    const orderId = await orderOf(shop, customerId, ramo.id);
    const before = await getOrder(shop.owner, orderId);
    const lineId = before.lines[0]!.id;
    const costBefore = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderLine.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, id: lineId },
        select: { unitCostMinor: true },
      }),
    );

    await expect(
      substituteOrderIngredient(shop.owner, orderId, {
        lineId,
        fromItemId: freedom.id,
        toItemId: explorer.id,
      }),
    ).rejects.toMatchObject({
      fieldErrors: { customerAgreed: 'substitution_customer_required' },
    });
    // Un fiore di un altro tipo o unità non è un sostituto.
    await expect(
      substituteOrderIngredient(shop.owner, orderId, {
        lineId,
        fromItemId: freedom.id,
        toItemId: roseBunch.id,
        customerAgreed: 'on',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const result = await substituteOrderIngredient(shop.owner, orderId, {
      lineId,
      fromItemId: freedom.id,
      toItemId: explorer.id,
      customerAgreed: 'on',
    });
    expect(result).toEqual({ from: 'Rosa Freedom', to: 'Rosa Explorer' });

    const after = await getOrder(shop.owner, orderId);
    expect(after.totalMinor).toBe(before.totalMinor);
    expect(after.lines[0]!.recipe).toEqual([
      {
        name: 'Rosa',
        variety: 'Explorer',
        quantity: 12,
        saleUnit: 'STEM',
        replaces: { name: 'Rosa', variety: 'Freedom' },
      },
    ]);
    const costAfter = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderLine.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, id: lineId },
        select: { unitCostMinor: true },
      }),
    );
    expect(costAfter.unitCostMinor).toBe((costBefore.unitCostMinor ?? 0) + 12 * (1600 - 1400));

    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId: shop.owner.tenantId,
          action: 'order.ingredient_substituted',
          entityId: orderId,
        },
        select: { metadata: true },
      }),
    );
    expect(audit?.metadata).toMatchObject({
      name: 'Rosa Freedom',
      ingredientName: 'Rosa Explorer',
      customerAgreed: true,
      mode: 'ASK_CUSTOMER',
    });
  });

  it('"No se sustituye": nessuna proposta e il cambio si rifiuta', async () => {
    const strict = await bouquet(shop, 'Ramo estricto', 'NOT_ALLOWED', [
      { id: pinkTulip.id, quantity: 10 },
    ]);
    const orderId = await orderOf(shop, customerId, strict.id);
    await setCatalogItemAvailability(shop.owner, pinkTulip.id, 'OUT_OF_STOCK');
    const view = await getOrderSubstitutions(shop.owner, orderId);
    expect(view?.lines[0]).toMatchObject({ mode: 'NOT_ALLOWED' });
    expect(view?.lines[0]?.missing[0]?.candidates).toEqual([]);
    await expect(
      substituteOrderIngredient(shop.owner, orderId, {
        lineId: view!.lines[0]!.lineId,
        fromItemId: pinkTulip.id,
        toItemId: redCarnation.id,
        customerAgreed: 'on',
      }),
    ).rejects.toMatchObject({ reason: 'substitution_not_allowed' });
    await setCatalogItemAvailability(shop.owner, pinkTulip.id, 'AVAILABLE');
  });

  it('dopo "Listo" (merce già scaricata) non si cambia più', async () => {
    const ramo = await bouquet(shop, 'Ramo listo', 'SIMILAR_ALLOWED', [
      { id: freedom.id, quantity: 6 },
    ]);
    const orderId = await orderOf(shop, customerId, ramo.id);
    const lineId = (await getOrder(shop.owner, orderId)).lines[0]!.id;
    await changeOrderStatus(shop.owner, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.owner, orderId, 'READY', { confirmShortage: true });
    expect(await getOrderSubstitutions(shop.owner, orderId)).toBeNull();
    await expect(
      substituteOrderIngredient(shop.owner, orderId, {
        lineId,
        fromItemId: freedom.id,
        toItemId: explorer.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('i disegni del Diseñador si cambiano solo con l’ok del cliente', async () => {
    const design = await saveBouquetConfiguration(shop.owner, {
      name: 'Diseño para Sofía',
      style: 'ROMANTIC',
      size: 'MEDIUM',
      budget: '800',
      notes: '',
      lines: [
        { catalogItemId: freedom.id, quantity: 6 },
        { catalogItemId: eucalyptus.id, quantity: 1 },
      ],
    });
    const quote = await createQuoteFromConfiguration(shop.owner, {
      configurationId: design.id,
      customerId,
    });
    await changeQuoteStatus(shop.owner, quote.id, 'SENT');
    await changeQuoteStatus(shop.owner, quote.id, 'ACCEPTED');
    const { id: orderId } = await createOrderFromQuote(shop.owner, quote.id, pickup());
    await setCatalogItemAvailability(shop.owner, freedom.id, 'OUT_OF_STOCK');
    const view = await getOrderSubstitutions(shop.owner, orderId);
    expect(view?.lines[0]?.mode).toBe('ASK_CUSTOMER');
    await substituteOrderIngredient(shop.owner, orderId, {
      lineId: view!.lines[0]!.lineId,
      fromItemId: freedom.id,
      toItemId: explorer.id,
      customerAgreed: 'on',
    });
    await setCatalogItemAvailability(shop.owner, freedom.id, 'AVAILABLE');
    const order = await getOrder(shop.owner, orderId);
    expect(order.lines[0]!.recipe?.[0]).toMatchObject({
      name: 'Rosa',
      variety: 'Explorer',
      replaces: { name: 'Rosa', variety: 'Freedom' },
    });
    const snapshot = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderLine.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId },
        select: { snapshot: true },
      }),
    );
    const components = (snapshot.snapshot as { components: { catalogItemId: string }[] })
      .components;
    expect(components.map((component) => component.catalogItemId)).toEqual([
      explorer.id,
      eucalyptus.id,
    ]);
  });
});

describe('permessi e isolamento', () => {
  it('un pedido di un’altra fioreria non si legge né si cambia; un loro prodotto non è un sostituto', async () => {
    const foreignCustomer = await customerOf(other, 'Cliente Ajeno');
    const foreignRose = await createCatalogItem(
      other.owner,
      itemInput({ name: 'Rosa', variety: 'Ajena', canonicalFlowerId: rosa }),
    );
    const foreignBouquet = await bouquet(other, 'Ramo ajeno', 'SIMILAR_ALLOWED', [
      { id: foreignRose.id, quantity: 6 },
    ]);
    const foreignOrder = await orderOf(other, foreignCustomer, foreignBouquet.id);
    await expect(getOrderSubstitutions(shop.owner, foreignOrder)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      substituteOrderIngredient(shop.owner, foreignOrder, {
        lineId: (await getOrder(other.owner, foreignOrder)).lines[0]!.id,
        fromItemId: foreignRose.id,
        toItemId: explorer.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const ramo = await bouquet(shop, 'Ramo propio', 'SIMILAR_ALLOWED', [
      { id: freedom.id, quantity: 6 },
    ]);
    const mine = await orderOf(shop, customerId, ramo.id);
    await expect(
      substituteOrderIngredient(shop.owner, mine, {
        lineId: (await getOrder(shop.owner, mine)).lines[0]!.id,
        fromItemId: freedom.id,
        toItemId: foreignRose.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
