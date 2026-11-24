/**
 * Apartados con vencimiento (ADR-062): la merce apartada esce dal disponibile ma non dalla
 * giacenza; un apartado vale fino alla fine del giorno di scadenza; "Usar" scarica quanto si è
 * usato davvero; "Liberar" ed "Extender"; le funzioni per gli ordini; ruoli e isolamento A↔B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { addDays, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  checkStock,
  createCatalogItem,
  createReservation,
  extendReservation,
  getCatalogItemInventory,
  getInventoryItem,
  getReservation,
  listInventory,
  listInventoryMovements,
  listReservations,
  listTrackedProductOptions,
  recordStockOut,
  releaseReservation,
  releaseReservationTx,
  reserveStockTx,
  startInventoryTracking,
  consumeReservation,
  consumeReservationTx,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let operatorEmail: string;

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly roseItemId: string;
  readonly paperItemId: string;
  /** Un prodotto che la fioreria non controlla (compra a richiesta). */
  readonly ribbon: CatalogItemDto;
}

async function track(ctx: TenantContext, catalogItemId: string, quantity: number) {
  await startInventoryTracking(ctx, {
    rows: { '0': { catalogItemId, quantity: String(quantity) } },
  });
  const inventory = await getCatalogItemInventory(ctx, catalogItemId);
  if (!inventory?.item) throw new Error('prodotto non avviato');
  return inventory.item.id;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  const rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', costMinor: 1000 }),
  );
  const paper = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'PACKAGING',
      name: 'Papel kraft',
      variety: null,
      colors: ['brown'],
      saleUnit: 'PIECE',
      costMinor: null,
      heightCm: null,
      tags: [],
    }),
  );
  const ribbon = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'ACCESSORY',
      name: 'Listón',
      variety: null,
      colors: ['red'],
      saleUnit: 'PIECE',
      costMinor: 500,
      heightCm: null,
      tags: [],
    }),
  );
  return {
    shop,
    rose,
    ribbon,
    // Rosa: 50 steli al costo del catalogo (10,00); carta: nessuna.
    roseItemId: await track(shop.owner, rose.id, 50),
    paperItemId: await track(shop.owner, paper.id, 0),
  };
}

/** Giorno "AAAA-MM-GG" a `days` giorni da oggi, nel calendario della fioreria. */
function dayFromToday(ctx: TenantContext, days: number): string {
  return toIsoDate(addDays(todayInTimeZone(ctx.timezone), days));
}

/** Fa passare il tempo: la scadenza dell'apartado diventa ieri. */
async function expire(reservationId: string, ctx: TenantContext) {
  const yesterday = addDays(todayInTimeZone(ctx.timezone), -1);
  await withSystemContext(db, { reason: 'test: scadenza passata' }, (tx) =>
    tx.inventoryReservation.update({
      where: { id: reservationId },
      data: { expiresOn: new Date(Date.UTC(yesterday.year, yesterday.month - 1, yesterday.day)) },
    }),
  );
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Apartados' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
});

afterAll(async () => {
  await disconnectDb();
});

describe('apartar', () => {
  it('toglie merce dal disponibile, non dalla giacenza; gli usi lo rispettano', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    const { reservationId, missing } = await createReservation(kit.shop.manager, {
      label: 'Boda de Ana',
      expiresOn: dayFromToday(owner, 3),
      note: 'Iglesia a las 5',
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '30' } },
    });
    expect(missing).toBe(0);

    const rose = await getInventoryItem(owner, kit.roseItemId);
    expect(rose).toMatchObject({ onHand: 50, reserved: 30, available: 20, status: 'OK' });
    expect(rose.reservations).toEqual([
      { id: reservationId, label: 'Boda de Ana', expiresOn: dayFromToday(owner, 3), quantity: 30 },
    ]);
    const list = await listInventory(owner, {});
    expect(list.items.find((item) => item.id === kit.roseItemId)).toMatchObject({
      reserved: 30,
      available: 20,
    });
    expect(
      (await listTrackedProductOptions(owner)).find(
        (option) => option.inventoryItemId === kit.roseItemId,
      ),
    ).toMatchObject({ available: 20 });

    // Un uso di 25 lascerebbe l'apartado scoperto: serve la conferma.
    const use = { quantity: '25', note: '' };
    await expect(recordStockOut(owner, kit.roseItemId, 'USE', use)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      await recordStockOut(owner, kit.roseItemId, 'USE', { ...use, confirmShortage: 'on' }),
    ).toMatchObject({ onHand: 25, missing: 5 });
    // Per gli ordini: 25 in giacenza, 30 apartados → nulla disponibile.
    const check = await checkStock(owner, [{ catalogItemId: kit.rose.id, quantity: 10 }]);
    expect(check.shortages).toMatchObject([{ available: -5, missing: 10 }]);
    expect((await getInventoryItem(owner, kit.roseItemId)).status).toBe('OUT');
  });

  it('se la merce non basta chiede la conferma; lo stesso prodotto si somma', async () => {
    const kit = await createKit();
    const input = {
      label: 'Evento Hotel',
      expiresOn: dayFromToday(kit.shop.owner, 1),
      lines: {
        '0': { inventoryItemId: kit.roseItemId, quantity: '20' },
        '1': { inventoryItemId: kit.roseItemId, quantity: '2x20' },
        '2': { inventoryItemId: kit.paperItemId, quantity: '5' },
      },
    };
    await expect(createReservation(kit.shop.owner, input)).rejects.toMatchObject({
      reason: 'inventory_insufficient_stock',
    });
    const created = await createReservation(kit.shop.owner, { ...input, confirmShortage: 'on' });
    // Rose: 60 su 50 (mancano 10); carta: 5 su 0.
    expect(created.missing).toBe(15);
    const detail = await getReservation(kit.shop.owner, created.reservationId);
    expect(detail.lines.map((line) => [line.name, line.quantity])).toEqual([
      ['Papel kraft', 5],
      ['Rosa roja', 60],
    ]);
    expect(detail).toMatchObject({ state: 'ACTIVE', daysLeft: 1, canWrite: true });

    await expect(
      createReservation(kit.shop.owner, { ...input, expiresOn: dayFromToday(kit.shop.owner, -1) }),
    ).rejects.toMatchObject({ fieldErrors: { expiresOn: 'inventory_expiry_past' } });
    await expect(
      createReservation(kit.shop.owner, { ...input, expiresOn: dayFromToday(kit.shop.owner, 91) }),
    ).rejects.toMatchObject({ fieldErrors: { expiresOn: 'inventory_expiry_too_far' } });
  });
});

describe('usar, liberar, extender', () => {
  it('usar: esce quanto si è usato davvero e l’apartado si chiude', async () => {
    const kit = await createKit();
    const manager = kit.shop.manager;
    const { reservationId } = await createReservation(manager, {
      label: 'Boda de Ana',
      expiresOn: dayFromToday(manager, 2),
      lines: {
        '0': { inventoryItemId: kit.roseItemId, quantity: '30' },
        '1': { inventoryItemId: kit.paperItemId, quantity: '4' },
      },
      confirmShortage: 'on',
    });
    const before = await getReservation(manager, reservationId);
    const roseLine = before.lines.find((line) => line.inventoryItemId === kit.roseItemId);
    const paperLine = before.lines.find((line) => line.inventoryItemId === kit.paperItemId);
    if (!roseLine || !paperLine) throw new Error('righe mancanti');
    expect(roseLine).toMatchObject({ onHand: 50, availableForThis: 50 });

    const used = await consumeReservation(manager, reservationId, {
      lines: {
        '0': { lineId: roseLine.id, quantity: '28' },
        '1': { lineId: paperLine.id, quantity: '0' },
      },
    });
    expect(used).toMatchObject({ missing: 0, expectedCostMinor: 28_000, actualCostMinor: 28_000 });
    expect(used.entryId).not.toBeNull();

    // Le 2 rose non usate restano in giacenza e tornano disponibili.
    expect(await getInventoryItem(manager, kit.roseItemId)).toMatchObject({
      onHand: 22,
      reserved: 0,
      available: 22,
    });
    const after = await getReservation(manager, reservationId);
    expect(after).toMatchObject({ status: 'USED', state: 'USED', usedEntryId: used.entryId });
    expect(after.lines.map((line) => [line.name, line.usedQuantity])).toEqual([
      ['Papel kraft', 0],
      ['Rosa roja', 28],
    ]);
    expect(after.closedByName).not.toBeNull();
    const movements = await listInventoryMovements(manager, { kind: 'USE' });
    expect(movements.movements[0]).toMatchObject({ quantity: -28, note: 'Boda de Ana' });

    // Già usato: non si usa, non si libera, non si estende.
    const again = { lines: { '0': { lineId: roseLine.id, quantity: '1' } } };
    // Una alla volta: ogni tentativo parte solo quando il precedente è finito.
    for (const attempt of [
      () => consumeReservation(manager, reservationId, again),
      () => releaseReservation(manager, reservationId),
      () => extendReservation(manager, reservationId, { expiresOn: dayFromToday(manager, 5) }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ reason: 'inventory_reservation_closed' });
    }
  });

  it('due "Usar" nello stesso istante: la merce esce una volta sola', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    const { reservationId } = await createReservation(owner, {
      label: 'Doble clic',
      expiresOn: dayFromToday(owner, 1),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '10' } },
    });
    const line = (await getReservation(owner, reservationId)).lines[0];
    if (!line) throw new Error('riga mancante');
    const input = { lines: { '0': { lineId: line.id, quantity: '10' } } };
    const results = await Promise.allSettled([
      consumeReservation(owner, reservationId, input),
      consumeReservation(kit.shop.manager, reservationId, input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      reason: 'inventory_reservation_closed',
    });
    expect((await getInventoryItem(owner, kit.roseItemId)).onHand).toBe(40);
  });

  it('usar senza quantità, o con le righe di un altro apartado, è un errore', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    const first = await createReservation(owner, {
      label: 'Primero',
      expiresOn: dayFromToday(owner, 2),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '5' } },
    });
    const second = await createReservation(owner, {
      label: 'Segundo',
      expiresOn: dayFromToday(owner, 2),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '5' } },
    });
    const otherLine = (await getReservation(owner, second.reservationId)).lines[0];
    const ownLine = (await getReservation(owner, first.reservationId)).lines[0];
    if (!otherLine || !ownLine) throw new Error('righe mancanti');
    await expect(
      consumeReservation(owner, first.reservationId, {
        lines: { '0': { lineId: ownLine.id, quantity: '0' } },
      }),
    ).rejects.toMatchObject({ fieldErrors: { lines: 'inventory_nothing_used' } });
    await expect(
      consumeReservation(owner, first.reservationId, {
        lines: { '0': { lineId: otherLine.id, quantity: '5' } },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getInventoryItem(owner, kit.roseItemId)).onHand).toBe(50);
  });

  it('vale fino alla fine del giorno: vencido non tiene merce, extender lo riattiva', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    const { reservationId } = await createReservation(owner, {
      label: 'Cumpleaños Luis',
      expiresOn: dayFromToday(owner, 0),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '30' } },
    });
    // Scade oggi: vale ancora.
    expect((await getInventoryItem(owner, kit.roseItemId)).reserved).toBe(30);
    expect((await listReservations(owner, {})).items.map((item) => item.id)).toEqual([
      reservationId,
    ]);

    await expire(reservationId, owner);
    expect((await getInventoryItem(owner, kit.roseItemId)).reserved).toBe(0);
    const expired = await listReservations(owner, { view: 'expired' });
    expect(expired.items).toMatchObject([{ id: reservationId, state: 'EXPIRED', daysLeft: -1 }]);
    expect(expired.counts).toEqual({ current: 0, expired: 1, closed: 0 });

    await expect(
      extendReservation(owner, reservationId, { expiresOn: dayFromToday(owner, -1) }),
    ).rejects.toMatchObject({ fieldErrors: { expiresOn: 'inventory_expiry_past' } });
    await extendReservation(owner, reservationId, { expiresOn: dayFromToday(owner, 5) });
    expect(await getReservation(owner, reservationId)).toMatchObject({
      state: 'ACTIVE',
      daysLeft: 5,
    });
    expect((await getInventoryItem(owner, kit.roseItemId)).reserved).toBe(30);

    await releaseReservation(owner, reservationId);
    expect(await getReservation(owner, reservationId)).toMatchObject({ state: 'RELEASED' });
    expect((await getInventoryItem(owner, kit.roseItemId)).reserved).toBe(0);
    const closed = await listReservations(owner, { view: 'closed', q: 'luis' });
    expect(closed.items.map((item) => item.id)).toEqual([reservationId]);
    expect((await listReservations(owner, { view: 'closed', q: 'ana' })).items).toEqual([]);
    // La giacenza non è mai cambiata.
    expect((await getInventoryItem(owner, kit.roseItemId)).onHand).toBe(50);
  });
});

describe('per gli ordini', () => {
  it('apartar, usare e liberare nella transazione di chi chiama', async () => {
    const kit = await createKit();
    const ctx = kit.shop.staff;
    const expiresOn = addDays(todayInTimeZone(ctx.timezone), 2);
    // Lo staff può farlo da un ordine: i permessi li controlla chi chiama.
    const reserved = await withTenantContext(db, ctx, (tx) =>
      reserveStockTx(tx, ctx, {
        label: 'PED-0007',
        expiresOn,
        lines: [
          { catalogItemId: kit.rose.id, quantity: 10 },
          { catalogItemId: kit.ribbon.id, quantity: 3 },
        ],
        confirmShortage: false,
      }),
    );
    expect(reserved.reservationId).not.toBeNull();
    expect(reserved.lines).toMatchObject([
      { catalogItemId: kit.rose.id, tracked: true, available: 50, missing: 0 },
      { catalogItemId: kit.ribbon.id, tracked: false },
    ]);
    expect((await getInventoryItem(kit.shop.owner, kit.roseItemId)).reserved).toBe(10);

    // Solo prodotti non controllati: niente da apartar.
    const none = await withTenantContext(db, ctx, (tx) =>
      reserveStockTx(tx, ctx, {
        label: 'PED-0008',
        expiresOn,
        lines: [{ catalogItemId: kit.ribbon.id, quantity: 2 }],
        confirmShortage: false,
      }),
    );
    expect(none.reservationId).toBeNull();

    // Usato con quanto è servito davvero; il listón non si controlla e si ignora.
    const reservationId = reserved.reservationId ?? '';
    const used = await withTenantContext(db, ctx, (tx) =>
      consumeReservationTx(tx, ctx, reservationId, {
        lines: [
          { catalogItemId: kit.rose.id, quantity: 12 },
          { catalogItemId: kit.ribbon.id, quantity: 3 },
        ],
        confirmShortage: false,
      }),
    );
    expect(used).toMatchObject({ missing: 0, expectedCostMinor: 12_000 });
    expect(await getInventoryItem(kit.shop.owner, kit.roseItemId)).toMatchObject({
      onHand: 38,
      reserved: 0,
    });

    // Liberare un apartado già usato non fa nulla; uno attivo si libera una volta.
    expect(
      await withTenantContext(db, ctx, (tx) => releaseReservationTx(tx, ctx, reservationId)),
    ).toBe(false);
    const other = await withTenantContext(db, ctx, (tx) =>
      reserveStockTx(tx, ctx, {
        label: 'PED-0009',
        expiresOn,
        lines: [{ catalogItemId: kit.rose.id, quantity: 5 }],
        confirmShortage: false,
      }),
    );
    const otherId = other.reservationId ?? '';
    expect(await withTenantContext(db, ctx, (tx) => releaseReservationTx(tx, ctx, otherId))).toBe(
      true,
    );
    expect(await withTenantContext(db, ctx, (tx) => releaseReservationTx(tx, ctx, otherId))).toBe(
      false,
    );
    expect((await getInventoryItem(kit.shop.owner, kit.roseItemId)).reserved).toBe(0);
  });

  it('fase di prova (D-29): senza abbonamento si apparta solo la merce controllata', async () => {
    const basic = await createTestShop('Florería Basic Apartados');
    const rose = await createCatalogItem(basic.owner, itemInput());
    const ctx = basic.owner;
    const result = await withTenantContext(db, ctx, (tx) =>
      reserveStockTx(tx, ctx, {
        label: 'PED-0001',
        expiresOn: todayInTimeZone(ctx.timezone),
        lines: [{ catalogItemId: rose.id, quantity: 3 }],
        confirmShortage: false,
      }),
    );
    // Il prodotto non è nell'inventario: niente da apartare (non dipende dal piano).
    expect(result.reservationId).toBeNull();
    await expect(listReservations(ctx, {})).resolves.toMatchObject({ items: [], total: 0 });
  });
});

describe('ruoli e isolamento', () => {
  it('lo staff vede gli apartados ma non li crea né li cambia', async () => {
    const kit = await createKit();
    const { reservationId } = await createReservation(kit.shop.owner, {
      label: 'Boda',
      expiresOn: dayFromToday(kit.shop.owner, 2),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '3' } },
    });
    const staff = kit.shop.staff;
    expect((await listReservations(staff, {})).canWrite).toBe(false);
    expect((await getReservation(staff, reservationId)).canWrite).toBe(false);
    await expect(
      createReservation(staff, {
        label: 'X',
        expiresOn: dayFromToday(staff, 1),
        lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '1' } },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(releaseReservation(staff, reservationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      extendReservation(staff, reservationId, { expiresOn: dayFromToday(staff, 3) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(consumeReservation(staff, reservationId, { lines: {} })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('un’altra fioreria non vede né tocca gli apartados e i prodotti: 404', async () => {
    const a = await createKit('Florería Apartados A');
    const b = await createKit('Florería Apartados B');
    const { reservationId } = await createReservation(a.shop.owner, {
      label: 'Boda en A',
      expiresOn: dayFromToday(a.shop.owner, 2),
      lines: { '0': { inventoryItemId: a.roseItemId, quantity: '10' } },
    });
    const line = (await getReservation(a.shop.owner, reservationId)).lines[0];
    if (!line) throw new Error('riga mancante');
    const owner = b.shop.owner;

    expect((await listReservations(owner, {})).items).toEqual([]);
    await expect(getReservation(owner, reservationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(releaseReservation(owner, reservationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      extendReservation(owner, reservationId, { expiresOn: dayFromToday(owner, 3) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      consumeReservation(owner, reservationId, {
        lines: { '0': { lineId: line.id, quantity: '10' } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Il prodotto di A in un apartado di B: 404.
    await expect(
      createReservation(owner, {
        label: 'Intruso',
        expiresOn: dayFromToday(owner, 1),
        lines: { '0': { inventoryItemId: a.roseItemId, quantity: '1' } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Dalla transazione di B l'apartado di A non esiste.
    await expect(
      withTenantContext(db, owner, (tx) => releaseReservationTx(tx, owner, reservationId)),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await getInventoryItem(a.shop.owner, a.roseItemId)).toMatchObject({
      onHand: 50,
      reserved: 10,
    });
    expect((await getInventoryItem(b.shop.owner, b.roseItemId)).reserved).toBe(0);
    expect((await getReservation(a.shop.owner, reservationId)).state).toBe('ACTIVE');

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: { in: [reservationId, a.roseItemId] } },
        select: { entityType: true },
      }),
    );
    expect(new Set(events.map((event) => event.entityType))).toEqual(
      new Set(['InventoryReservation', 'InventoryItem']),
    );
  });
});
