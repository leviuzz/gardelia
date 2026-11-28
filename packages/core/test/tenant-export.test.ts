import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { dayOfWeek, parseCsv, todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  addCarePlant,
  addCatalogItemToOrder,
  addCustomerAddress,
  confirmCareContract,
  confirmDraftOrder,
  createCareContract,
  createCareSlot,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  exportTenantData,
  getCareSettings,
  recordCareChargePayment,
  recordOrderPayment,
  reverseOrderPayment,
  updateCareSettings,
  updatePrimaryLocation,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * "Descargar los datos de la florería" (ADR-079): solo il titolare, un CSV per area dentro uno ZIP,
 * testi che non diventano formule in Excel, nessun dato di un'altra fioreria, registro senza PII.
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;

function todayIso(): string {
  const today = todayInTimeZone('America/Mexico_City');
  return new Date(Date.UTC(today.year, today.month - 1, today.day)).toISOString().slice(0, 10);
}

function tomorrow(): string {
  const today = todayInTimeZone('America/Mexico_City');
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1)).toISOString().slice(0, 10);
}

const customerInput = (displayName: string, phone: string | null) => ({
  type: 'PERSON',
  displayName,
  legalName: null,
  taxId: null,
  email: null,
  phone,
  notes: null,
  preferences: null,
  restrictions: null,
  tags: ['boda'],
  acquisitionChannel: null,
  marketingConsent: true,
});

/** I file dello ZIP, già letti come tabelle (senza BOM). */
async function exportOf(target: TestShop) {
  const file = await exportTenantData(target.owner);
  const entries = unzipSync(file.bytes);
  const table = (name: string) => {
    const bytes = entries[name]!;
    // UTF-8 con BOM: Excel riconosce gli accenti (il decodificatore lo toglie leggendo).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, ...rows] = parseCsv(strFromU8(bytes).replace(/^\uFEFF/, ''), ',');
    return rows.map((row) => Object.fromEntries(header!.map((key, i) => [key, row[i] ?? ''])));
  };
  return { file, entries, table };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Exporta');
  other = await createTestShop('Florería Ajena Exporta');

  const customer = await createCustomer(
    shop.owner,
    customerInput('=HYPERLINK("http://malo","clic")', '+524495550123'),
  );
  const rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa, roja "premium"', priceMinor: 3550, costMinor: 1400 }),
  );
  const { id } = await createDraftOrder(shop.owner, { customerId: customer.id });
  await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '10' });
  await confirmDraftOrder(shop.owner, id, {
    fulfillmentMode: 'PICKUP',
    scheduledDate: tomorrow(),
    windowStart: '',
    windowEnd: '',
    customerAddressId: '',
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '¡Feliz día, mamá!',
    cardSignature: 'Ana',
    deliveryFee: '',
    notes: '',
  });
  await recordOrderPayment(shop.owner, id, { amount: '100', method: 'CASH', kind: 'DEPOSIT' });

  // Un contratto di Floral Care per lo stesso cliente: il cargo del mese nasce alla conferma
  // (ADR-082) e si paga in parte.
  await updatePrimaryLocation(shop.owner, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_export_${shop.tenant.slug}`,
    latitude: '21.8818',
    longitude: '-102.2916',
  });
  await updateCareSettings(shop.owner, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
  const slot = await createCareSlot(shop.owner, {
    weekday: String(dayOfWeek(todayInTimeZone(shop.owner.timezone))),
    start: '00:20',
    end: '00:40',
    capacity: '2',
  });
  const place = await addCustomerAddress(shop.owner, customer.id, {
    label: 'Oficina',
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Universidad 100',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    placeId: `ChIJ_export_place_${shop.tenant.slug}`,
    latitude: '21.9',
    longitude: '-102.2916',
  });
  const watering = (await getCareSettings(shop.owner)).services
    .filter((service) => service.presetKey === 'watering')
    .map((service) => service.id);
  const contract = await createCareContract(shop.owner, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slot.id],
    startDate: todayIso(),
    seats: '',
    serviceIds: watering,
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: '',
    notes: '',
    outOfRangeConfirmed: '',
  });
  await addCarePlant(shop.owner, contract.id, { name: 'Potos', quantity: '12', size: 'MEDIUM' });
  await confirmCareContract(shop.owner, contract.id);
  const charge = await withTenantContext(db, shop.owner, (tx) =>
    tx.careCharge.findFirstOrThrow({
      where: { tenantId: shop.owner.tenantId, subscriptionId: contract.id },
    }),
  );
  await recordCareChargePayment(shop.owner, contract.id, charge.id, {
    amount: '100',
    method: 'TRANSFER',
    paidOn: '',
    reference: 'SPEI 4821',
    note: '',
  });

  await createCustomer(other.owner, customerInput('Cliente de la otra florería', null));
});

afterAll(async () => {
  await disconnectDb();
});

describe('esportazione dei dati della fioreria', () => {
  it('solo il titolare la scarica', async () => {
    await expect(exportTenantData(shop.manager)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportTenantData(shop.staff)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("uno ZIP con il LEEME e un CSV per area, con i dati e le parole dell'app", async () => {
    const { file, entries, table } = await exportOf(shop);
    expect(file.fileName).toMatch(
      new RegExp(`^gardelia-${shop.tenant.slug}-\\d{4}-\\d{2}-\\d{2}\\.zip$`),
    );
    expect(Object.keys(entries).sort()).toEqual(
      [
        'LEEME.txt',
        'catalogo.csv',
        'clientes.csv',
        'cotizaciones.csv',
        'cotizaciones_conceptos.csv',
        'direcciones.csv',
        'equipo.csv',
        'fechas_especiales.csv',
        'floral_care_accesos.csv',
        'floral_care_bloqueos.csv',
        'floral_care_cargos.csv',
        'floral_care_cargos_conceptos.csv',
        'floral_care_contratos.csv',
        'floral_care_mensajes.csv',
        'floral_care_pagos.csv',
        'floral_care_plantas.csv',
        'floral_care_visitas.csv',
        'inventario.csv',
        'movimientos_inventario.csv',
        'pagos.csv',
        'pedidos.csv',
        'pedidos_cambios.csv',
        'pedidos_comprobantes.csv',
        'pedidos_conceptos.csv',
        'pedidos_efectivo.csv',
        'pedidos_mensajes.csv',
        'proveedores.csv',
        'recetas.csv',
      ].sort(),
    );
    expect(strFromU8(entries['LEEME.txt']!)).toContain('Datos de Florería Exporta');

    const [customer] = table('clientes.csv');
    // Il nome resta testo: Excel non lo esegue come formula.
    expect(customer).toMatchObject({
      Nombre: '\'=HYPERLINK("http://malo","clic")',
      Teléfono: '+524495550123',
      Etiquetas: 'boda',
      'Acepta promociones': 'sí',
      Estado: 'Activo',
    });

    const [order] = table('pedidos.csv');
    expect(order).toMatchObject({
      Número: 'PED-0001',
      cliente_id: customer!.id,
      Estado: 'Confirmado',
      Entrega: 'Recoge en tienda',
      Fecha: tomorrow(),
      'Mensaje de la tarjeta': '¡Feliz día, mamá!',
      Total: '355.00',
      Pagado: '100.00',
      Pago: 'Anticipo',
    });
    expect(table('pedidos_conceptos.csv')).toEqual([
      expect.objectContaining({
        Pedido: 'PED-0001',
        Concepto: expect.stringContaining('Rosa, roja "premium"'),
        Cantidad: '10',
        'Precio unitario': '35.50',
        Total: '355.00',
      }),
    ]);
    expect(table('pagos.csv')).toEqual([
      expect.objectContaining({
        Pedido: 'PED-0001',
        Tipo: 'Anticipo',
        'Forma de pago': 'Efectivo',
        Importe: '100.00',
      }),
    ]);
    expect(table('catalogo.csv')).toEqual([
      expect.objectContaining({ Nombre: 'Rosa, roja "premium"', Precio: '35.50', Costo: '14.00' }),
    ]);
    expect(
      table('equipo.csv')
        .map((row) => row.Rol)
        .sort(),
    ).toEqual(['Equipo', 'Gerente', 'Propietario'].sort());

    // Floral Care: il cargo del mese, le sue righe e il pagamento (ADR-082).
    const [charge] = table('floral_care_cargos.csv');
    expect(charge).toMatchObject({
      Número: 'CAR-0001',
      Contrato: 'SUS-0001',
      cliente_id: customer!.id,
      Cliente: '\'=HYPERLINK("http://malo","clic")',
      Pagado: '100.00',
      Estado: 'Pago parcial',
      'Cargo final': 'no',
      Moneda: 'MXN',
    });
    expect(Number(charge!.Saldo)).toBeCloseTo(Number(charge!.Total) - 100, 2);
    expect(table('floral_care_cargos_conceptos.csv')).toEqual([
      expect.objectContaining({ Cargo: 'CAR-0001', Concepto: 'Visitas del mes' }),
    ]);
    expect(table('floral_care_pagos.csv')).toEqual([
      expect.objectContaining({
        Tipo: 'Pago',
        Estado: 'Registrado',
        cliente_id: customer!.id,
        'Forma de pago': 'Transferencia',
        Importe: '100.00',
        Cargos: 'CAR-0001: 100.00',
        Referencia: 'SPEI 4821',
      }),
    ]);
  });

  it('uno storno esce in pagos.csv col segno meno', async () => {
    const order = await withTenantContext(db, shop.owner, (tx) =>
      tx.order.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId },
        select: { id: true },
      }),
    );
    await recordOrderPayment(shop.owner, order.id, {
      amount: '20',
      method: 'TRANSFER',
      kind: 'BALANCE',
    });
    const wrong = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderPayment.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId: order.id, amountMinor: 2000 },
        select: { id: true },
      }),
    );
    await reverseOrderPayment(shop.owner, order.id, wrong.id);
    const { table } = await exportOf(shop);
    const amounts = table('pagos.csv').map((row) => row.Importe);
    expect(amounts.sort()).toEqual(['-20.00', '100.00', '20.00'].sort());
  });

  it("nessun dato di un'altra fioreria (A↔B) e nel registro solo i conteggi", async () => {
    const { entries } = await exportOf(shop);
    const everything = Object.values(entries)
      .map((bytes) => strFromU8(bytes))
      .join('\n');
    expect(everything).not.toContain('Cliente de la otra florería');
    expect(everything).not.toContain('Florería Ajena Exporta');

    const theirs = await exportOf(other);
    const names = theirs.table('clientes.csv').map((row) => row.Nombre);
    expect(names).toEqual(['Cliente de la otra florería']);

    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: shop.owner.tenantId, action: 'tenant.data_exported' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit?.actorUserId).toBe(shop.owner.userId);
    expect(JSON.stringify(audit?.metadata)).not.toContain('HYPERLINK');
    expect(audit?.metadata).toMatchObject({
      files: { 'clientes.csv': 1, 'pedidos.csv': 1, 'floral_care_pagos.csv': 1 },
    });
    // Nel registro niente referencia del pagamento.
    expect(JSON.stringify(audit?.metadata)).not.toContain('SPEI');
  });
});
