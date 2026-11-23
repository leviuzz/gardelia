/**
 * Etichette e filtri dei clienti (CRM-01, ADR-070): filtri della lista per etichetta, consenso e
 * data speciale vicina; un'etichetta aggiunta o tolta a più clienti insieme, solo da proprietario
 * e manager; i clienti di un'altra fioreria non si toccano (404 per tutto il gruppo).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { CUSTOMER_LIMITS, todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addCustomerOccasion,
  createCustomer,
  getCustomer,
  listCustomerTags,
  listCustomers,
  setCustomerArchived,
  updateCustomerTags,
  type TenantContext,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

const db = getDb();
let shop: TestShop;
let other: TestShop;

function person(name: string, extra: { tags?: string[]; marketingConsent?: boolean } = {}) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: null,
    notes: null,
    preferences: null,
    restrictions: null,
    tags: extra.tags ?? [],
    acquisitionChannel: null,
    marketingConsent: extra.marketingConsent ?? false,
  };
}

/** Mese e giorno fra `offset` giorni nel fuso della fioreria. */
function inDays(ctx: TenantContext, offset: number) {
  const today = todayInTimeZone(ctx.timezone);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
  return { month: String(date.getUTCMonth() + 1), day: String(date.getUTCDate()) };
}

async function names(ctx: TenantContext, filters: Record<string, string>) {
  const result = await listCustomers(ctx, filters);
  return result.items.map((item) => item.displayName);
}

beforeAll(async () => {
  shop = await createTestShop('Florería Etiquetas');
  other = await createTestShop('Florería Etiquetas Ajena');
});

afterAll(async () => {
  await disconnectDb();
});

describe('filtri della lista clienti', () => {
  it('etichetta, consenso marketing e fecha especial próxima, anche insieme', async () => {
    const owner = shop.owner;
    const ana = await createCustomer(
      owner,
      person('Filtro Ana', { tags: ['bodas', 'vip'], marketingConsent: true }),
    );
    await createCustomer(owner, person('Filtro Beto', { tags: ['vip'] }));
    const carla = await createCustomer(owner, person('Filtro Carla'));
    const dario = await createCustomer(owner, person('Filtro Darío', { tags: ['bodas'] }));
    await addCustomerOccasion(owner, ana.id, { type: 'BIRTHDAY', ...inDays(owner, 10) });
    await addCustomerOccasion(owner, carla.id, { type: 'ANNIVERSARY', ...inDays(owner, 0) });
    await addCustomerOccasion(owner, dario.id, { type: 'BIRTHDAY', ...inDays(owner, 45) });

    expect(await names(shop.staff, { q: 'Filtro', tag: 'VIP ' })).toEqual([
      'Filtro Ana',
      'Filtro Beto',
    ]);
    expect(await names(shop.staff, { q: 'Filtro', consent: 'yes' })).toEqual(['Filtro Ana']);
    expect(await names(shop.staff, { q: 'Filtro', consent: 'no' })).toEqual([
      'Filtro Beto',
      'Filtro Carla',
      'Filtro Darío',
    ]);
    // Oggi e fra 10 giorni sì; fra 45 giorni no.
    expect(await names(shop.staff, { q: 'Filtro', upcoming: '1' })).toEqual([
      'Filtro Ana',
      'Filtro Carla',
    ]);
    expect(await names(shop.staff, { tag: 'bodas', upcoming: '1', consent: 'yes' })).toEqual([
      'Filtro Ana',
    ]);
    // Archiviati: restano fuori dalla lista attiva anche con una data vicina.
    await setCustomerArchived(owner, carla.id, true);
    expect(await names(shop.staff, { q: 'Filtro', upcoming: '1' })).toEqual(['Filtro Ana']);
    expect(await names(shop.staff, { q: 'Filtro', upcoming: '1', status: 'ARCHIVED' })).toEqual([
      'Filtro Carla',
    ]);
  });

  it('le etichette proposte sono solo quelle della fioreria', async () => {
    await createCustomer(other.owner, person('Ajeno', { tags: ['solo-ajena'] }));
    const tags = await listCustomerTags(shop.staff);
    expect(tags).toEqual(expect.arrayContaining(['bodas', 'vip']));
    expect(tags).not.toContain('solo-ajena');
    expect([...tags]).toEqual([...tags].sort());
    expect(await listCustomerTags(other.staff)).toEqual(['solo-ajena']);
  });
});

describe('etichetta a più clienti', () => {
  it('aggiunge e toglie, salta chi ha già 15 etichette e lascia una voce nel registro', async () => {
    const manager = shop.manager;
    const first = await createCustomer(manager, person('Grupo Uno'));
    const second = await createCustomer(manager, person('Grupo Dos', { tags: ['mayoreo'] }));
    const fullTags = Array.from({ length: CUSTOMER_LIMITS.tags }, (_, index) => `t${index}`);
    const third = await createCustomer(manager, person('Grupo Tres', { tags: fullTags }));
    const ids = [first.id, second.id, third.id];

    await expect(
      updateCustomerTags(manager, { customerIds: ids, tag: ' Mayoreo ', mode: 'add' }),
    ).resolves.toEqual({ mode: 'add', tag: 'mayoreo', changed: 1, unchanged: 1, full: 1 });
    expect((await getCustomer(manager, first.id)).tags).toEqual(['mayoreo']);
    expect((await getCustomer(manager, third.id)).tags).toEqual(fullTags);

    await expect(
      updateCustomerTags(shop.owner, { customerIds: ids, tag: 'mayoreo', mode: 'remove' }),
    ).resolves.toEqual({ mode: 'remove', tag: 'mayoreo', changed: 2, unchanged: 1, full: 0 });
    expect((await getCustomer(manager, second.id)).tags).toEqual([]);

    const entries = await withSystemContext(db, { reason: 'test: registro etichette' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: shop.tenant.tenantId,
          action: { in: ['customer.tags_added', 'customer.tags_removed'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { action: true, entityId: true, metadata: true },
      }),
    );
    expect(entries).toEqual([
      {
        action: 'customer.tags_added',
        entityId: null,
        metadata: { count: 1, customerIds: [first.id] },
      },
      {
        action: 'customer.tags_removed',
        entityId: null,
        metadata: { count: 2, customerIds: expect.arrayContaining([first.id, second.id]) },
      },
    ]);
    // Il testo dell'etichetta non finisce nel registro.
    expect(JSON.stringify(entries)).not.toContain('mayoreo');
  });

  it('lo staff non etichetta; input non valido → errori per campo', async () => {
    const customer = await createCustomer(shop.owner, person('Grupo Staff'));
    await expect(
      updateCustomerTags(shop.staff, { customerIds: [customer.id], tag: 'vip', mode: 'add' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const invalid = updateCustomerTags(shop.owner, { customerIds: [], tag: ' ', mode: 'x' });
    await expect(invalid).rejects.toBeInstanceOf(ValidationError);
    await expect(invalid).rejects.toMatchObject({
      fieldErrors: {
        customerIds: 'customers_none_selected',
        tag: 'required',
        mode: 'invalid_option',
      },
    });
  });

  it('un cliente di un’altra fioreria nel gruppo: 404, nessuna modifica, evento di sicurezza', async () => {
    const mine = await createCustomer(shop.owner, person('Grupo Mío'));
    const foreign = await createCustomer(other.owner, person('Grupo Ajeno'));
    await expect(
      updateCustomerTags(shop.owner, {
        customerIds: [mine.id, foreign.id],
        tag: 'intruso',
        mode: 'add',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getCustomer(shop.owner, mine.id)).tags).toEqual([]);
    expect((await getCustomer(other.owner, foreign.id)).tags).toEqual([]);
    // La lista dell'altra fioreria non vede i clienti di questa nemmeno filtrando.
    expect(await names(other.staff, { q: 'Grupo Mío' })).toEqual([]);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: foreign.id },
        select: { entityType: true },
      }),
    );
    expect(events.map((event) => event.entityType)).toContain('Customer');
  });
});
