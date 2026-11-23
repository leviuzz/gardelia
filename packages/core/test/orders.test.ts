import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addCatalogItemToOrder,
  addCatalogItemToQuote,
  addCustomLineToOrder,
  addCustomerAddress,
  cancelOrder,
  changeOrderStatus,
  changeQuoteStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createOrderFromQuote,
  createQuote,
  discardDraftOrder,
  getOrder,
  getQuoteOrder,
  listOrders,
  recordOrderPayment,
  removeOrderLine,
  reverseOrderPayment,
  updateOrderDiscount,
  updateOrderFulfillment,
  updateOrderLineQuantity,
  updateQuoteDetails,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();

function customer(name: string) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550142',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

function isoDate(parts: { year: number; month: number; day: number }, plusDays = 0): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays));
  return date.toISOString().slice(0, 10);
}

let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;
let addressId: string;
let today: string;
let tomorrow: string;

function todayParts() {
  return todayInTimeZone(shop.owner.timezone);
}

/** Preventivo accettato: 12 rose (12 × 35,00) con 20,00 di sconto = 400,00. */
async function acceptedQuote(ctx: TenantContext = shop.owner, forCustomer = customerId) {
  const { id } = await createQuote(ctx, { customerId: forCustomer });
  await addCatalogItemToQuote(ctx, id, { catalogItemId: rose.id, quantity: '12' });
  await updateQuoteDetails(ctx, id, { title: '', notes: '', discount: '20', validUntil: '' });
  await changeQuoteStatus(ctx, id, 'SENT');
  await changeQuoteStatus(ctx, id, 'ACCEPTED');
  return id;
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentMode: 'DELIVERY',
    scheduledDate: tomorrow,
    windowStart: '10:00',
    windowEnd: '13:00',
    customerAddressId: addressId,
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '¡Feliz cumpleaños, mamá!',
    cardSignature: 'Tu hija',
    deliveryFee: '80',
    notes: '',
    ...overrides,
  };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Pedidos');
  other = await createTestShop('Florería Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
  customerId = (await createCustomer(shop.owner, customer('Ana Torres'))).id;
  addressId = (
    await addCustomerAddress(shop.owner, customerId, {
      label: 'Mamá',
      recipientName: 'Rosa Torres',
      recipientPhone: '449 555 0199',
      addressLine1: 'Av. Madero 120',
      addressLine2: '',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryNotes: 'Portón verde',
      isDefault: 'on',
    })
  ).id;
  const parts = todayInTimeZone(shop.owner.timezone);
  today = isoDate(parts);
  tomorrow = isoDate(parts, 1);
});

afterAll(async () => {
  await disconnectDb();
});

describe('convertir una cotización en pedido', () => {
  it('copia conceptos y totales, suma el envío y deja el pedido confirmado', async () => {
    const quoteId = await acceptedQuote();
    const { id, number } = await createOrderFromQuote(shop.owner, quoteId, delivery());
    expect(number).toBeGreaterThan(0);

    const order = await getOrder(shop.owner, id);
    expect(order.numberLabel).toMatch(/^PED-\d{4}$/);
    expect(order.status).toBe('CONFIRMED');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.description).toContain('Rosa roja');
    expect(order.lines[0]?.quantity).toBe(12);
    expect(order.subtotalMinor).toBe(42000);
    expect(order.discountMinor).toBe(2000);
    expect(order.deliveryFeeMinor).toBe(8000);
    expect(order.totalMinor).toBe(48000);
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.balanceMinor).toBe(48000);
    expect(order.windowStart).toBe('10:00');
    expect(order.windowEnd).toBe('13:00');
    // Destinatario e referencias dalla rubrica, indirizzo copiato nell'ordine.
    expect(order.recipientName).toBe('Rosa Torres');
    expect(order.recipientPhone).toBe('+524495550199');
    expect(order.deliveryNotes).toBe('Portón verde');
    expect(order.deliveryAddress).toMatchObject({
      addressLine1: 'Av. Madero 120',
      city: 'Aguascalientes',
    });
    expect(order.cardMessage).toBe('¡Feliz cumpleaños, mamá!');
    expect(order.events.map((event) => event.toStatus)).toEqual(['CONFIRMED']);
    expect(order.quote?.id).toBe(quoteId);
    expect(await getQuoteOrder(shop.owner, quoteId)).toEqual({
      id,
      numberLabel: order.numberLabel,
    });
  });

  it('solo cotizaciones aceptadas, y una sola vez', async () => {
    const { id: draft } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, draft, { catalogItemId: rose.id, quantity: '1' });
    await expect(createOrderFromQuote(shop.owner, draft, delivery())).rejects.toMatchObject({
      reason: 'quote_not_accepted',
    });

    const accepted = await acceptedQuote();
    await createOrderFromQuote(shop.owner, accepted, delivery());
    await expect(createOrderFromQuote(shop.owner, accepted, delivery())).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('a domicilio pide una dirección completa; el retiro no cobra envío', async () => {
    const quoteId = await acceptedQuote();
    const noAddress = createOrderFromQuote(
      shop.owner,
      quoteId,
      delivery({
        customerAddressId: '',
        addressLine1: '',
        city: '',
        region: 'AGU',
        postalCode: '',
      }),
    );
    await expect(noAddress).rejects.toBeInstanceOf(ValidationError);
    await expect(noAddress).rejects.toMatchObject({
      fieldErrors: { addressLine1: 'required', postalCode: 'invalid_postal_code' },
    });

    await expect(
      createOrderFromQuote(shop.owner, quoteId, delivery({ fulfillmentMode: 'PICKUP' })),
    ).rejects.toMatchObject({ fieldErrors: { deliveryFee: 'out_of_range' } });

    const pickup = await createOrderFromQuote(
      shop.owner,
      quoteId,
      delivery({ fulfillmentMode: 'PICKUP', deliveryFee: '', customerAddressId: '' }),
    );
    const order = await getOrder(shop.owner, pickup.id);
    expect(order.fulfillmentMode).toBe('PICKUP');
    expect(order.deliveryAddress).toBeNull();
    expect(order.totalMinor).toBe(40000);
  });

  it('una dirección nueva se valida como la de la agenda', async () => {
    const quoteId = await acceptedQuote();
    const { id } = await createOrderFromQuote(
      shop.owner,
      quoteId,
      delivery({
        customerAddressId: '',
        addressLine1: 'Calle Juárez 15',
        addressLine2: 'Depto 3',
        neighborhood: 'San Marcos',
        city: 'Aguascalientes',
        region: 'AGU',
        postalCode: '20070',
        recipientName: 'Luis',
      }),
    );
    const order = await getOrder(shop.owner, id);
    expect(order.customerAddressId).toBeNull();
    expect(order.deliveryAddress).toMatchObject({
      addressLine1: 'Calle Juárez 15',
      postalCode: '20070',
    });
    expect(order.recipientName).toBe('Luis');
  });

  it('rechaza fechas pasadas y direcciones de otro cliente', async () => {
    const quoteId = await acceptedQuote();
    await expect(
      createOrderFromQuote(shop.owner, quoteId, delivery({ scheduledDate: '2020-01-01' })),
    ).rejects.toMatchObject({ fieldErrors: { scheduledDate: 'out_of_range' } });

    const stranger = (await createCustomer(shop.owner, customer('Otro cliente'))).id;
    const strangerQuote = await acceptedQuote(shop.owner, stranger);
    await expect(createOrderFromQuote(shop.owner, strangerQuote, delivery())).rejects.toMatchObject(
      { fieldErrors: { customerAddressId: 'invalid_option' } },
    );
  });
});

describe('estados del pedido', () => {
  it('avanza hasta entregado y guarda la historia', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await changeOrderStatus(shop.staff, id, 'IN_PREPARATION');
    await changeOrderStatus(shop.staff, id, 'READY');
    await expect(changeOrderStatus(shop.staff, id, 'PICKED_UP')).rejects.toMatchObject({
      reason: 'invalid_status_transition',
    });
    await changeOrderStatus(shop.staff, id, 'OUT_FOR_DELIVERY');
    await changeOrderStatus(shop.staff, id, 'DELIVERED');
    const order = await getOrder(shop.staff, id);
    expect(order.status).toBe('DELIVERED');
    expect(order.nextSteps).toEqual([]);
    expect(order.events.map((event) => event.toStatus)).toEqual([
      'CONFIRMED',
      'IN_PREPARATION',
      'READY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    await expect(cancelOrder(shop.owner, id, { reason: 'tarde' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('no salta pasos ni vuelve de un estado final', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await expect(changeOrderStatus(shop.owner, id, 'DELIVERED')).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(changeOrderStatus(shop.owner, id, 'CANCELLED')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('cancelar pide un motivo y cierra el pedido', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await expect(cancelOrder(shop.owner, id, { reason: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await cancelOrder(shop.owner, id, { reason: 'El cliente cambió de fecha' });
    const order = await getOrder(shop.owner, id);
    expect(order.status).toBe('CANCELLED');
    expect(order.cancelReason).toBe('El cliente cambió de fecha');
    expect(order.canRecordPayments).toBe(false);
    expect(order.balanceMinor).toBe(0);
    await expect(changeOrderStatus(shop.owner, id, 'IN_PREPARATION')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('pagos registrados', () => {
  it('anticipo, saldo y anulación con el estado del pago', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await recordOrderPayment(shop.owner, id, { amount: '200', method: 'CASH', kind: 'DEPOSIT' });
    let order = await getOrder(shop.owner, id);
    expect(order.paymentStatus).toBe('PARTIAL');
    expect(order.balanceMinor).toBe(28000);

    await expect(
      recordOrderPayment(shop.owner, id, { amount: '300', method: 'TRANSFER', kind: 'BALANCE' }),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'payment_exceeds_balance' } });
    await expect(
      recordOrderPayment(shop.owner, id, {
        amount: '10',
        method: 'CASH',
        kind: 'BALANCE',
        paidOn: isoDate(todayInTimeZone(shop.owner.timezone), 2),
      }),
    ).rejects.toMatchObject({ fieldErrors: { paidOn: 'out_of_range' } });

    await recordOrderPayment(shop.owner, id, {
      amount: '280',
      method: 'TRANSFER',
      kind: 'BALANCE',
      paidOn: today,
      reference: 'SPEI 123',
    });
    order = await getOrder(shop.owner, id);
    expect(order.paymentStatus).toBe('PAID');
    expect(order.paidMinor).toBe(48000);

    const deposit = order.payments[0];
    if (!deposit) throw new Error('falta el anticipo');
    await reverseOrderPayment(shop.owner, id, deposit.id);
    order = await getOrder(shop.owner, id);
    expect(order.paymentStatus).toBe('PARTIAL');
    expect(order.paidMinor).toBe(28000);
    expect(order.payments.map((payment) => [payment.kind, payment.amountMinor])).toEqual([
      ['DEPOSIT', 20000],
      ['BALANCE', 28000],
      ['REVERSAL', -20000],
    ]);
    await expect(reverseOrderPayment(shop.owner, id, deposit.id)).rejects.toMatchObject({
      reason: 'payment_already_reversed',
    });
  });

  it('cambiar el envío recalcula total y estado del pago', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await recordOrderPayment(shop.owner, id, { amount: '400', method: 'CASH', kind: 'DEPOSIT' });
    await updateOrderFulfillment(shop.owner, id, delivery({ deliveryFee: '120' }));
    let order = await getOrder(shop.owner, id);
    expect(order.totalMinor).toBe(52000);
    expect(order.paymentStatus).toBe('PARTIAL');

    await updateOrderFulfillment(
      shop.owner,
      id,
      delivery({ fulfillmentMode: 'PICKUP', deliveryFee: '', customerAddressId: '' }),
    );
    order = await getOrder(shop.owner, id);
    expect(order.totalMinor).toBe(40000);
    expect(order.paymentStatus).toBe('PAID');
    expect(order.deliveryAddress).toBeNull();

    await changeOrderStatus(shop.owner, id, 'READY');
    await changeOrderStatus(shop.owner, id, 'PICKED_UP');
    await expect(updateOrderFulfillment(shop.owner, id, delivery())).rejects.toMatchObject({
      reason: 'order_not_editable',
    });
  });

  it('el banco avanza pedidos pero no cobra, no cancela ni crea', async () => {
    const quoteId = await acceptedQuote();
    await expect(createOrderFromQuote(shop.staff, quoteId, delivery())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const { id } = await createOrderFromQuote(shop.manager, quoteId, delivery());
    await expect(
      recordOrderPayment(shop.staff, id, { amount: '10', method: 'CASH', kind: 'DEPOSIT' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelOrder(shop.staff, id, { reason: 'x' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateOrderFulfillment(shop.staff, id, delivery())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const order = await getOrder(shop.staff, id);
    expect(order.editable).toBe(false);
    expect(order.canRecordPayments).toBe(false);
    expect(order.nextSteps).toEqual(['IN_PREPARATION', 'READY']);
  });

  it('el base de datos rechaza un estado de pago incoherente', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.order.update({ where: { id }, data: { paymentStatus: 'PAID' } }),
      ),
    ).rejects.toThrow();
  });
});

describe('lista de pedidos', () => {
  it('filtra por día, por pendientes de pago y busca por número', async () => {
    const quoteId = await acceptedQuote();
    const { id } = await createOrderFromQuote(
      shop.owner,
      quoteId,
      delivery({ scheduledDate: today, windowStart: '', windowEnd: '' }),
    );
    const order = await getOrder(shop.owner, id);

    const todays = await listOrders(shop.owner, { when: 'today' });
    expect(todays.items.map((item) => item.id)).toContain(id);
    expect(todays.items.every((item) => item.scheduledDate === today)).toBe(true);

    const tomorrows = await listOrders(shop.owner, { when: 'tomorrow' });
    expect(tomorrows.items.map((item) => item.id)).not.toContain(id);

    const unpaid = await listOrders(shop.owner, { when: 'all', unpaid: '1' });
    expect(unpaid.items.map((item) => item.id)).toContain(id);

    const byNumber = await listOrders(shop.owner, { when: 'all', q: order.numberLabel });
    expect(byNumber.items.map((item) => item.id)).toEqual([id]);
  });
});

describe('pedido directo (borrador)', () => {
  /** Borrador con 6 rosas (6 × 35,00 = 210,00). */
  async function draftWithRoses(ctx: TenantContext = shop.owner) {
    const { id } = await createDraftOrder(ctx, { customerId });
    await addCatalogItemToOrder(ctx, id, { catalogItemId: rose.id, quantity: '6' });
    return id;
  }

  it('se arma con productos y conceptos, y al confirmar queda listo para preparar', async () => {
    const { id, number } = await createDraftOrder(shop.owner, { customerId });
    let order = await getOrder(shop.owner, id);
    expect(order).toMatchObject({
      number,
      status: 'DRAFT',
      scheduledDate: null,
      totalMinor: 0,
      linesEditable: true,
      editable: false,
      canCancel: false,
      canDiscard: true,
      canRecordPayments: false,
      nextSteps: [],
    });

    // El precio lo pone el catálogo, nunca el cliente; el mismo producto suma cantidades.
    await addCatalogItemToOrder(shop.owner, id, {
      catalogItemId: rose.id,
      quantity: '5',
      unitPrice: '1',
    });
    await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    await addCustomLineToOrder(shop.owner, id, {
      description: 'Globo metálico',
      quantity: '2',
      unitPrice: '45.50',
    });
    order = await getOrder(shop.owner, id);
    expect(order.lines.map((line) => [line.description, line.quantity])).toEqual([
      ['Rosa roja · Freedom', 6],
      ['Globo metálico', 2],
    ]);
    expect(order.subtotalMinor).toBe(6 * 3500 + 2 * 4550);

    const globe = order.lines[1]!;
    await updateOrderLineQuantity(shop.owner, id, globe.id, '1');
    await updateOrderDiscount(shop.owner, id, { discount: '10' });
    order = await getOrder(shop.owner, id);
    expect(order.subtotalMinor).toBe(21000 + 4550);
    expect(order.discountMinor).toBe(1000);
    expect(order.totalMinor).toBe(24550);

    await confirmDraftOrder(shop.owner, id, delivery({ deliveryFee: '60' }));
    order = await getOrder(shop.owner, id);
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      scheduledDate: tomorrow,
      fulfillmentMode: 'DELIVERY',
      deliveryFeeMinor: 6000,
      totalMinor: 30550,
      paymentStatus: 'UNPAID',
      cardMessage: '¡Feliz cumpleaños, mamá!',
      canDiscard: false,
      canCancel: true,
      canRecordPayments: true,
    });
    expect(order.quote).toBeNull();
    expect(order.events.map((event) => [event.fromStatus, event.toStatus])).toEqual([
      [null, 'DRAFT'],
      ['DRAFT', 'CONFIRMED'],
    ]);
    await changeOrderStatus(shop.staff, id, 'IN_PREPARATION');

    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findMany({ where: { entityId: id }, select: { action: true } }),
    );
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['order.created', 'order.line_added', 'order.confirmed']),
    );
  });

  it('no se confirma vacío, no cobra ni se edita la entrega antes de confirmar', async () => {
    const { id } = await createDraftOrder(shop.owner, { customerId });
    await expect(confirmDraftOrder(shop.owner, id, delivery())).rejects.toMatchObject({
      reason: 'order_empty',
    });
    await expect(
      recordOrderPayment(shop.owner, id, { amount: '10', method: 'CASH', kind: 'DEPOSIT' }),
    ).rejects.toMatchObject({ reason: 'order_not_confirmed' });
    await expect(updateOrderFulfillment(shop.owner, id, delivery())).rejects.toMatchObject({
      reason: 'order_not_editable',
    });
    await expect(cancelOrder(shop.owner, id, { reason: 'x' })).rejects.toMatchObject({
      reason: 'invalid_status_transition',
    });
    // La confirmación valida la entrega como "Convertir en pedido".
    await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    await expect(
      confirmDraftOrder(shop.owner, id, delivery({ scheduledDate: isoDate(todayParts(), -1) })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getOrder(shop.owner, id)).status).toBe('DRAFT');
  });

  it('un borrador descartado no pide motivo y desaparece de las listas', async () => {
    const id = await draftWithRoses();
    expect((await listOrders(shop.owner, { when: 'drafts' })).items.map((i) => i.id)).toContain(id);
    expect((await listOrders(shop.owner, { when: 'all' })).items.map((i) => i.id)).not.toContain(
      id,
    );

    await discardDraftOrder(shop.owner, id);
    const order = await getOrder(shop.owner, id);
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelReason: null,
      canDiscard: false,
      linesEditable: false,
    });
    for (const when of ['drafts', 'all', 'upcoming']) {
      expect((await listOrders(shop.owner, { when })).items.map((i) => i.id)).not.toContain(id);
    }
    await expect(discardDraftOrder(shop.owner, id)).rejects.toMatchObject({
      reason: 'invalid_status_transition',
    });
    await expect(
      addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '1' }),
    ).rejects.toMatchObject({ reason: 'order_lines_locked' });
  });

  it('después de confirmar: nunca vacío, nunca por debajo de lo pagado, cerrado al estar listo', async () => {
    const id = await draftWithRoses();
    await addCustomLineToOrder(shop.owner, id, {
      description: 'Tarjeta grande',
      quantity: '1',
      unitPrice: '30',
    });
    await confirmDraftOrder(
      shop.owner,
      id,
      delivery({ fulfillmentMode: 'PICKUP', deliveryFee: '' }),
    );
    let order = await getOrder(shop.owner, id);
    expect(order.totalMinor).toBe(24000);

    await recordOrderPayment(shop.owner, id, { amount: '230', method: 'CASH', kind: 'DEPOSIT' });
    const card = order.lines.find((line) => line.description === 'Tarjeta grande')!;
    const roses = order.lines.find((line) => line.kind === 'CATALOG_ITEM')!;
    // Quitar la tarjeta dejaría 210,00 con 230,00 ya pagados: primero se anula el pago.
    await expect(removeOrderLine(shop.owner, id, card.id)).rejects.toMatchObject({
      reason: 'order_total_below_paid',
    });
    await expect(updateOrderDiscount(shop.owner, id, { discount: '20' })).rejects.toMatchObject({
      reason: 'order_total_below_paid',
    });
    await updateOrderLineQuantity(shop.owner, id, roses.id, '8');
    await removeOrderLine(shop.owner, id, card.id);
    order = await getOrder(shop.owner, id);
    expect(order).toMatchObject({ totalMinor: 28000, paidMinor: 23000, paymentStatus: 'PARTIAL' });
    await expect(removeOrderLine(shop.owner, id, roses.id)).rejects.toMatchObject({
      reason: 'order_empty',
    });

    await changeOrderStatus(shop.staff, id, 'READY');
    await expect(
      addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '1' }),
    ).rejects.toMatchObject({ reason: 'order_lines_locked' });
    expect((await getOrder(shop.owner, id)).linesEditable).toBe(false);
  });

  it('el envío tampoco deja el total por debajo de lo pagado', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await recordOrderPayment(shop.owner, id, {
      amount: '480',
      method: 'TRANSFER',
      kind: 'DEPOSIT',
    });
    await expect(
      updateOrderFulfillment(shop.owner, id, delivery({ deliveryFee: '0' })),
    ).rejects.toMatchObject({ reason: 'order_total_below_paid' });
    expect((await getOrder(shop.owner, id)).deliveryFeeMinor).toBe(8000);
  });

  it('el banco no arma pedidos; el cliente debe existir y estar activo', async () => {
    await expect(createDraftOrder(shop.staff, { customerId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const id = await draftWithRoses();
    await expect(
      addCatalogItemToOrder(shop.staff, id, { catalogItemId: rose.id, quantity: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(discardDraftOrder(shop.staff, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createDraftOrder(shop.owner, { customerId: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createDraftOrder(shop.owner, { customerId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('la base de datos exige el motivo para cancelar un pedido confirmado', async () => {
    const { id } = await createOrderFromQuote(shop.owner, await acceptedQuote(), delivery());
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.order.update({ where: { id }, data: { status: 'CANCELLED' } }),
      ),
    ).rejects.toThrow();
    const draft = await createDraftOrder(shop.owner, { customerId });
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.order.update({ where: { id: draft.id }, data: { status: 'CONFIRMED' } }),
      ),
    ).rejects.toThrow();
  });

  it('otra florería no arma, confirma ni descarta borradores ajenos', async () => {
    const id = await draftWithRoses();
    await expect(createDraftOrder(other.owner, { customerId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      addCustomLineToOrder(other.owner, id, { description: 'x', quantity: '1', unitPrice: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmDraftOrder(other.owner, id, delivery())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(discardDraftOrder(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateOrderDiscount(other.owner, id, { discount: '1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // L'articolo di un'altra fioreria non entra nel borrador.
    const foreign = await createCatalogItem(other.owner, itemInput({ name: 'Rosa ajena' }));
    await expect(
      addCatalogItemToOrder(shop.owner, id, { catalogItemId: foreign.id, quantity: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const order = await getOrder(shop.owner, id);
    expect(order.status).toBe('DRAFT');
    expect(order.lines).toHaveLength(1);
    expect((await listOrders(other.owner, { when: 'drafts' })).items).toEqual([]);
  });
});

describe('aislamiento entre florerías', () => {
  it('otra florería no ve, no convierte, no cobra ni avanza pedidos ajenos', async () => {
    const quoteId = await acceptedQuote();
    const { id } = await createOrderFromQuote(shop.owner, quoteId, delivery());

    await expect(getOrder(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createOrderFromQuote(other.owner, quoteId, delivery())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(changeOrderStatus(other.owner, id, 'IN_PREPARATION')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      recordOrderPayment(other.owner, id, { amount: '10', method: 'CASH', kind: 'DEPOSIT' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelOrder(other.owner, id, { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listOrders(other.owner, { when: 'all' })).items).toEqual([]);
    expect(await getQuoteOrder(other.owner, quoteId)).toBeNull();

    // La RLS esconde le righe anche a una query senza filtro esplicito.
    const visible = await withTenantContext(db, other.owner, (tx) =>
      tx.order.findMany({ where: { id } }),
    );
    expect(visible).toEqual([]);

    const events = await withSystemContext(db, { reason: 'test: read security events' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: id, action: 'security.cross_tenant_access_attempt' },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });
});
