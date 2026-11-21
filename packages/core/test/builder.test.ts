import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ForbiddenError,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  createCatalogItem,
  createCustomer,
  createQuoteFromConfiguration,
  getBouquetConfiguration,
  getBuilderCatalog,
  getQuote,
  listBouquetConfigurations,
  saveBouquetConfiguration,
  setBouquetConfigurationArchived,
  updateBuilderSettings,
  updateCatalogItem,
  type CatalogItemDto,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let operatorEmail: string;

async function withPlus(shop: TestShop): Promise<TestShop> {
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  return shop;
}

function customerInput(name = 'Cliente del Builder') {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550199',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

function design(lines: { catalogItemId: string; quantity: number }[], overrides = {}) {
  return {
    name: 'Ramo para Sofía',
    style: 'ROMANTIC',
    size: 'MEDIUM',
    budget: '800',
    notes: '',
    lines,
    ...overrides,
  };
}

let shop: TestShop;
let rose: CatalogItemDto;
let tulip: CatalogItemDto;
let kraft: CatalogItemDto;
let vase: CatalogItemDto;
let ribbon: CatalogItemDto;

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador de plataforma' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;

  shop = await withPlus(await createTestShop('Florería Builder'));
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
  tulip = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Tulipán rosa',
      variety: null,
      priceMinor: 5500,
      costMinor: 2500,
      availability: 'LIMITED',
    }),
  );
  kraft = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Papel kraft',
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      variety: null,
      colors: [],
      priceMinor: 3000,
      costMinor: 800,
    }),
  );
  vase = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Florero',
      type: 'CONTAINER',
      saleUnit: 'PIECE',
      variety: null,
      colors: [],
      priceMinor: 18000,
      costMinor: 7000,
    }),
  );
  ribbon = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Listón',
      type: 'ACCESSORY',
      saleUnit: 'PIECE',
      variety: null,
      colors: [],
      priceMinor: 1500,
      costMinor: 300,
    }),
  );
  await updateBuilderSettings(shop.owner, { laborFee: '50' });
});

afterAll(async () => {
  await disconnectDb();
});

describe('piano (BILL-01)', () => {
  it('una fioreria Basic non usa il Builder', async () => {
    const basic = await createTestShop();
    await expect(getBuilderCatalog(basic.owner)).rejects.toBeInstanceOf(PlanRequiredError);
    await expect(
      saveBouquetConfiguration(basic.owner, design([{ catalogItemId: rose.id, quantity: 3 }])),
    ).rejects.toBeInstanceOf(PlanRequiredError);
    await expect(updateBuilderSettings(basic.owner, { laborFee: '10' })).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });

  it('se il piano decade i disegni restano ma il Builder si blocca', async () => {
    const local = await withPlus(await createTestShop());
    const flower = await createCatalogItem(local.owner, itemInput({ name: 'Girasol' }));
    const { id } = await saveBouquetConfiguration(
      local.owner,
      design([{ catalogItemId: flower.id, quantity: 5 }]),
    );
    await assignTenantPlan({
      operatorEmail,
      tenantSlug: local.tenant.slug,
      planCode: 'PLUS',
      status: 'CANCELLED',
    });
    await expect(getBouquetConfiguration(local.owner, id)).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });
});

describe('catalogo del Builder', () => {
  it('mostra solo componenti attivi e abilitati, costi solo alla gestione', async () => {
    const bouquet = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Ramo armado', type: 'BOUQUET', saleUnit: 'PIECE', variety: null }),
    );
    const hidden = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa sin Builder', isBuilderEnabled: false }),
    );
    const catalog = await getBuilderCatalog(shop.manager);
    const ids = catalog.options.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining([rose.id, tulip.id, kraft.id, vase.id, ribbon.id]));
    expect(ids).not.toContain(bouquet.id);
    expect(ids).not.toContain(hidden.id);
    expect(catalog.options.find((option) => option.id === vase.id)?.role).toBe('PACKAGING');
    expect(catalog).toMatchObject({ laborFeeMinor: 5000, canViewCosts: true, canQuote: true });

    const staffView = await getBuilderCatalog(shop.staff);
    expect(staffView.options.every((option) => option.costMinor === null)).toBe(true);
    expect(staffView).toMatchObject({ canViewCosts: false, canQuote: false });
  });
});

describe('disegni e prezzo dal server', () => {
  it('BQ-01: 7 rose + 5 tulipani + packaging + armado, ignorando i prezzi del client', async () => {
    const { id } = await saveBouquetConfiguration(
      shop.manager,
      design([
        { catalogItemId: rose.id, quantity: 7, unitPriceMinor: 1 } as never,
        { catalogItemId: tulip.id, quantity: 5 },
        { catalogItemId: kraft.id, quantity: 1 },
      ]),
    );
    const saved = await getBouquetConfiguration(shop.manager, id);
    expect(saved).toMatchObject({
      name: 'Ramo para Sofía',
      style: 'ROMANTIC',
      size: 'MEDIUM',
      budgetMinor: 80000,
      componentsMinor: 55000,
      laborMinor: 5000,
      totalMinor: 60000,
      estimatedCostMinor: 7 * 1400 + 5 * 2500 + 800,
      flowerCount: 12,
    });
    expect(saved.lines.map((line) => [line.name, line.quantity, line.savedUnitPriceMinor])).toEqual(
      [
        ['Rosa roja', 7, 3500],
        ['Tulipán rosa', 5, 5500],
        ['Papel kraft', 1, 3000],
      ],
    );
    // Lo staff compone e salva, ma senza costi.
    const asStaff = await getBouquetConfiguration(shop.staff, id);
    expect(asStaff.estimatedCostMinor).toBeNull();
  });

  it('applica le regole di composizione e di disponibilità', async () => {
    const soldOut = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Peonía', availability: 'OUT_OF_STOCK' }),
    );
    const disabled = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa deshabilitada', isBuilderEnabled: false }),
    );
    const cases: [ReturnType<typeof design>, string][] = [
      [design([{ catalogItemId: kraft.id, quantity: 1 }]), 'builder_needs_flower'],
      [
        design([
          { catalogItemId: rose.id, quantity: 3 },
          { catalogItemId: kraft.id, quantity: 1 },
          { catalogItemId: vase.id, quantity: 1 },
        ]),
        'builder_one_packaging',
      ],
      [
        design([
          { catalogItemId: rose.id, quantity: 3 },
          { catalogItemId: kraft.id, quantity: 2 },
        ]),
        'builder_one_packaging',
      ],
      [design([{ catalogItemId: soldOut.id, quantity: 3 }]), 'item_unavailable'],
      [design([{ catalogItemId: disabled.id, quantity: 3 }]), 'builder_item_not_allowed'],
    ];
    for (const [input, code] of cases) {
      await expect(saveBouquetConfiguration(shop.owner, input)).rejects.toMatchObject({
        fieldErrors: { lines: code },
      });
    }
    await expect(
      saveBouquetConfiguration(shop.owner, design([{ catalogItemId: rose.id, quantity: 0 }])),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('aggiorna un disegno sostituendo le righe; archiviato non si modifica', async () => {
    const { id } = await saveBouquetConfiguration(
      shop.owner,
      design([{ catalogItemId: rose.id, quantity: 3 }]),
    );
    await saveBouquetConfiguration(
      shop.owner,
      design(
        [
          { catalogItemId: rose.id, quantity: 12 },
          { catalogItemId: ribbon.id, quantity: 2 },
          { catalogItemId: vase.id, quantity: 1 },
        ],
        { name: 'Florero de 12 rosas', budget: '' },
      ),
      id,
    );
    const updated = await getBouquetConfiguration(shop.owner, id);
    expect(updated).toMatchObject({
      name: 'Florero de 12 rosas',
      budgetMinor: null,
      totalMinor: 12 * 3500 + 2 * 1500 + 18000 + 5000,
      lineCount: 3,
    });

    await setBouquetConfigurationArchived(shop.owner, id, true);
    await expect(
      saveBouquetConfiguration(shop.owner, design([{ catalogItemId: rose.id, quantity: 1 }]), id),
    ).rejects.toMatchObject({ reason: 'builder_configuration_archived' });
    const archived = await listBouquetConfigurations(shop.owner, { status: 'ARCHIVED' });
    expect(archived.items.map((item) => item.id)).toContain(id);
    const active = await listBouquetConfigurations(shop.owner);
    expect(active.items.map((item) => item.id)).not.toContain(id);
  });
});

describe('dal disegno al preventivo (AI-BQ-06)', () => {
  it('crea il preventivo con la distinta esatta e i prezzi attuali', async () => {
    const local = await withPlus(await createTestShop());
    const localRose = await createCatalogItem(
      local.owner,
      itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
    );
    const localTulip = await createCatalogItem(
      local.owner,
      itemInput({ name: 'Tulipán', variety: null, priceMinor: 5500, availability: 'ON_REQUEST' }),
    );
    const { id: customerId } = await createCustomer(local.owner, customerInput());
    const { id: configurationId } = await saveBouquetConfiguration(
      local.owner,
      design([
        { catalogItemId: localRose.id, quantity: 7 },
        { catalogItemId: localTulip.id, quantity: 5 },
      ]),
    );
    // Il listino cambia dopo il salvataggio: il preventivo usa il prezzo attuale.
    await updateCatalogItem(
      local.owner,
      localRose.id,
      itemInput({ name: 'Rosa roja', priceMinor: 4000, costMinor: 1400 }),
    );

    const { id: quoteId } = await createQuoteFromConfiguration(local.manager, {
      configurationId,
      customerId,
    });
    const quote = await getQuote(local.owner, quoteId);
    expect(quote).toMatchObject({ status: 'DRAFT', subtotalMinor: 55500, totalMinor: 55500 });
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({
      kind: 'BUILDER',
      bouquetConfigurationId: configurationId,
      description: 'Ramo para Sofía',
      quantity: 1,
      unitPriceMinor: 7 * 4000 + 5 * 5500,
      availability: 'ON_REQUEST',
      // Costo dei materiali (armado escluso): costi attuali di listino.
      unitCostMinor: 7 * 1400 + 5 * 1400,
    });
    expect(quote.lines[0]?.recipe?.map((line) => [line.name, line.quantity])).toEqual([
      ['Rosa roja', 7],
      ['Tulipán', 5],
    ]);
    // Il disegno conserva i propri totali "al salvataggio".
    expect((await getBouquetConfiguration(local.owner, configurationId)).totalMinor).toBe(52000);

    // Lo staff compone ma non crea preventivi.
    await expect(
      createQuoteFromConfiguration(local.staff, { configurationId, customerId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('se il catalogo è cambiato e un componente non è più disponibile, chiede di rivedere', async () => {
    const local = await withPlus(await createTestShop());
    const flower = await createCatalogItem(local.owner, itemInput({ name: 'Lilium' }));
    const { id: customerId } = await createCustomer(local.owner, customerInput());
    const { id: configurationId } = await saveBouquetConfiguration(
      local.owner,
      design([{ catalogItemId: flower.id, quantity: 4 }]),
    );
    await updateCatalogItem(
      local.owner,
      flower.id,
      itemInput({ name: 'Lilium', availability: 'OUT_OF_STOCK' }),
    );
    await expect(
      createQuoteFromConfiguration(local.owner, { configurationId, customerId }),
    ).rejects.toMatchObject({ reason: 'builder_configuration_outdated' });
    const config = await getBouquetConfiguration(local.owner, configurationId);
    expect(config.lines[0]).toMatchObject({ usable: false, availability: 'OUT_OF_STOCK' });
  });
});

describe('isolamento A ↔ B', () => {
  it('B non vede, non modifica e non quota i disegni di A, né usa i suoi articoli', async () => {
    const other = await withPlus(await createTestShop('Florería B Builder'));
    const otherFlower = await createCatalogItem(other.owner, itemInput({ name: 'Rosa B' }));
    const { id: otherCustomer } = await createCustomer(other.owner, customerInput('Cliente B'));
    const { id } = await saveBouquetConfiguration(
      shop.owner,
      design([{ catalogItemId: rose.id, quantity: 5 }]),
    );

    await expect(getBouquetConfiguration(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveBouquetConfiguration(
        other.owner,
        design([{ catalogItemId: otherFlower.id, quantity: 1 }]),
        id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setBouquetConfigurationArchived(other.owner, id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createQuoteFromConfiguration(other.owner, { configurationId: id, customerId: otherCustomer }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveBouquetConfiguration(other.owner, design([{ catalogItemId: rose.id, quantity: 2 }])),
    ).rejects.toMatchObject({ fieldErrors: { lines: 'builder_item_not_allowed' } });
    expect(
      (await listBouquetConfigurations(other.owner)).items.map((item) => item.id),
    ).not.toContain(id);

    // A non può usare un cliente di B per quotare il proprio disegno.
    await expect(
      createQuoteFromConfiguration(shop.owner, { configurationId: id, customerId: otherCustomer }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const untouched = await getBouquetConfiguration(shop.owner, id);
    expect(untouched).toMatchObject({ status: 'ACTIVE', lineCount: 1 });
  });

  it('un disegno archiviato o un ID non valido non si quotano', async () => {
    const local = await withPlus(await createTestShop());
    const flower = await createCatalogItem(local.owner, itemInput({ name: 'Clavel' }));
    const { id: customerId } = await createCustomer(local.owner, customerInput());
    const { id: configurationId } = await saveBouquetConfiguration(
      local.owner,
      design([{ catalogItemId: flower.id, quantity: 4 }]),
    );
    await setBouquetConfigurationArchived(local.owner, configurationId, true);
    await expect(
      createQuoteFromConfiguration(local.owner, { configurationId, customerId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createQuoteFromConfiguration(local.owner, { configurationId: 'no-uuid', customerId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
