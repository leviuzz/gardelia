import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addCatalogItemToQuote,
  addCustomLineToQuote,
  addRecipeLine,
  changeQuoteStatus,
  createCatalogItem,
  createCustomer,
  createQuote,
  getDashboard,
  getQuote,
  listCustomerQuotes,
  listQuotes,
  removeQuoteLine,
  updateCatalogItem,
  updateQuoteDetails,
  updateQuoteLineQuantity,
  updateRecipeDetails,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();

function customer(name = 'Cliente de prueba') {
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

let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let paper: CatalogItemDto;
let bouquet: CatalogItemDto;
let customerId: string;

beforeAll(async () => {
  shop = await createTestShop('Florería Cotizaciones');
  other = await createTestShop('Florería Otra');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
  paper = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Papel kraft',
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      priceMinor: 3000,
      costMinor: 800,
      colors: [],
      variety: null,
    }),
  );
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Ramo 12 rosas',
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      priceMinor: 69000,
      costMinor: null,
      variety: null,
    }),
  );
  await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 12 });
  await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: paper.id, quantity: 1 });
  await updateRecipeDetails(shop.owner, bouquet.id, {
    laborCostMinor: 6000,
    styleTags: [],
    notes: null,
    substitutionPolicy: 'ASK_CUSTOMER',
  });
  customerId = (await createCustomer(shop.owner, customer())).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe('creazione e numerazione', () => {
  it('numera i preventivi in sequenza per tenant e propaga l’origine del cliente', async () => {
    const local = await createTestShop();
    const { id: localCustomer } = await createCustomer(local.owner, customer());
    const first = await createQuote(local.owner, { customerId: localCustomer });
    const second = await createQuote(local.owner, { customerId: localCustomer });
    expect([first.number, second.number]).toEqual([1, 2]);
    const detail = await getQuote(local.owner, first.id);
    expect(detail).toMatchObject({
      numberLabel: 'COT-0001',
      status: 'DRAFT',
      acquisitionSource: 'MERCHANT_DIRECT',
      totalMinor: 0,
    });
    expect(detail.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('assegna numeri unici anche con creazioni concorrenti', async () => {
    const local = await createTestShop();
    const { id: localCustomer } = await createCustomer(local.owner, customer());
    const created = await Promise.all(
      Array.from({ length: 6 }, () => createQuote(local.owner, { customerId: localCustomer })),
    );
    expect(created.map((quote) => quote.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('righe, prezzi e snapshot', () => {
  it('prende prezzi e distinta dal catalogo e calcola i totali sul server', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    // Un prezzo inviato dal client viene ignorato: conta solo il catalogo.
    await addCatalogItemToQuote(shop.owner, id, {
      catalogItemId: bouquet.id,
      quantity: '2',
      unitPriceMinor: 1,
    });
    await addCustomLineToQuote(shop.owner, id, {
      description: 'Envío a domicilio',
      quantity: '1',
      unitPrice: '80',
    });
    const quote = await getQuote(shop.owner, id);
    expect(
      quote.lines.map((line) => [
        line.description,
        line.quantity,
        line.unitPriceMinor,
        line.lineTotalMinor,
      ]),
    ).toEqual([
      ['Ramo 12 rosas', 2, 69000, 138000],
      ['Envío a domicilio', 1, 8000, 8000],
    ]);
    expect(quote.lines[0]?.recipe).toEqual([
      { name: 'Rosa roja', variety: 'Freedom', quantity: 12, saleUnit: 'STEM' },
      { name: 'Papel kraft', variety: null, quantity: 1, saleUnit: 'PIECE' },
    ]);
    expect(quote).toMatchObject({ subtotalMinor: 146000, discountMinor: 0, totalMinor: 146000 });
    // Costo del ramo = materiali (12×14 + 8) + manodopera 60; la riga libera non ha costo → margine ignoto.
    expect(quote.lines[0]?.unitCostMinor).toBe(12 * 1400 + 800 + 6000);
    expect(quote.estimatedCostMinor).toBeNull();
  });

  it('ORD-01: un cambio di listino non altera i preventivi esistenti', async () => {
    const localRose = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa listino', priceMinor: 4000, costMinor: 1500 }),
    );
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: localRose.id, quantity: '10' });
    await updateCatalogItem(
      shop.owner,
      localRose.id,
      itemInput({ name: 'Rosa listino', priceMinor: 5000, costMinor: 2000 }),
    );

    const unchanged = await getQuote(shop.owner, id);
    expect(unchanged.lines[0]).toMatchObject({
      unitPriceMinor: 4000,
      unitCostMinor: 1500,
      lineTotalMinor: 40000,
    });
    expect(unchanged.totalMinor).toBe(40000);

    const { id: newer } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, newer, { catalogItemId: localRose.id, quantity: '10' });
    expect((await getQuote(shop.owner, newer)).totalMinor).toBe(50000);
  });

  it('somma le quantità dello stesso articolo, aggiorna e rimuove righe con totali coerenti', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '3' });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '2' });
    let quote = await getQuote(shop.owner, id);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]?.quantity).toBe(5);
    await updateQuoteLineQuantity(shop.owner, id, quote.lines[0]!.id, '7');
    quote = await getQuote(shop.owner, id);
    expect(quote.totalMinor).toBe(7 * 3500);
    expect(quote.estimatedCostMinor).toBe(7 * 1400);
    expect(quote.estimatedMarginMinor).toBe(7 * 3500 - 7 * 1400);
    await removeQuoteLine(shop.owner, id, quote.lines[0]!.id);
    expect((await getQuote(shop.owner, id)).totalMinor).toBe(0);
  });

  it('sconto: valido fino al subtotale, ridotto automaticamente se le righe calano', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '10' });
    await updateQuoteDetails(shop.owner, id, {
      title: 'Arreglo recepción',
      notes: '',
      discount: '50',
      validUntil: '',
    });
    let quote = await getQuote(shop.owner, id);
    expect(quote).toMatchObject({
      title: 'Arreglo recepción',
      discountMinor: 5000,
      totalMinor: 30000,
      validUntil: null,
    });
    await expect(updateQuoteDetails(shop.owner, id, { discount: '351' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await updateQuoteLineQuantity(shop.owner, id, quote.lines[0]!.id, '1');
    quote = await getQuote(shop.owner, id);
    expect(quote).toMatchObject({ subtotalMinor: 3500, discountMinor: 3500, totalMinor: 0 });
  });

  it('rifiuta articoli esauriti o di un altro tenant', async () => {
    const soldOut = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Peonía agotada', availability: 'OUT_OF_STOCK' }),
    );
    const foreign = await createCatalogItem(
      other.owner,
      itemInput({ name: 'Rosa de otra florería' }),
    );
    const { id } = await createQuote(shop.owner, { customerId });
    await expect(
      addCatalogItemToQuote(shop.owner, id, { catalogItemId: soldOut.id, quantity: '1' }),
    ).rejects.toMatchObject({ fieldErrors: { catalogItemId: 'item_unavailable' } });
    await expect(
      addCatalogItemToQuote(shop.owner, id, { catalogItemId: foreign.id, quantity: '1' }),
    ).rejects.toMatchObject({ fieldErrors: { catalogItemId: 'invalid_option' } });
  });
});

describe('stati', () => {
  it('bozza → inviata → accettata; dopo l’invio non si modifica; si può riaprire', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await expect(changeQuoteStatus(shop.owner, id, 'SENT')).rejects.toMatchObject({
      reason: 'quote_empty',
    });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    await changeQuoteStatus(shop.owner, id, 'SENT');
    await expect(
      addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '1' }),
    ).rejects.toMatchObject({ reason: 'quote_not_editable' });
    await changeQuoteStatus(shop.owner, id, 'DRAFT');
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    await changeQuoteStatus(shop.owner, id, 'SENT');
    await changeQuoteStatus(shop.owner, id, 'ACCEPTED');
    const quote = await getQuote(shop.owner, id);
    expect(quote).toMatchObject({ status: 'ACCEPTED', editable: false, allowedTransitions: [] });
    await expect(changeQuoteStatus(shop.owner, id, 'CANCELLED')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('un preventivo inviato oltre la validità risulta scaduto', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    await changeQuoteStatus(shop.owner, id, 'SENT');
    await withTenantContext(db, shop.owner, (tx) =>
      tx.quote.update({ where: { id }, data: { validUntil: new Date(Date.UTC(2020, 0, 1)) } }),
    );
    expect((await getQuote(shop.owner, id)).status).toBe('EXPIRED');
    await expect(changeQuoteStatus(shop.owner, id, 'ACCEPTED')).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      (await listQuotes(shop.owner, { status: 'EXPIRED' })).items.map((quote) => quote.id),
    ).toContain(id);
  });

  it('la dashboard conta bozze e inviati non scaduti (solo del tenant)', async () => {
    const local = await createTestShop();
    const localRose = await createCatalogItem(
      local.owner,
      itemInput({ name: 'Rosa', priceMinor: 3500 }),
    );
    const { id: localCustomer } = await createCustomer(local.owner, customer());
    await createQuote(local.owner, { customerId: localCustomer });
    const sent = await createQuote(local.owner, { customerId: localCustomer });
    const expired = await createQuote(local.owner, { customerId: localCustomer });
    for (const quote of [sent, expired]) {
      await addCatalogItemToQuote(local.owner, quote.id, {
        catalogItemId: localRose.id,
        quantity: '1',
      });
      await changeQuoteStatus(local.owner, quote.id, 'SENT');
    }
    await withTenantContext(db, local.owner, (tx) =>
      tx.quote.update({
        where: { id: expired.id },
        data: { validUntil: new Date(Date.UTC(2020, 0, 1)) },
      }),
    );
    expect((await getDashboard(local.owner)).quotes).toEqual({ drafts: 1, sent: 1 });
    expect((await getDashboard(local.staff)).quotes).toEqual({ drafts: 1, sent: 1 });
    expect((await getDashboard(other.owner)).quotes).toEqual({ drafts: 0, sent: 0 });
  });

  it('cerca per numero o cliente ed elenca i preventivi del cliente', async () => {
    const { id: localCustomer } = await createCustomer(shop.owner, customer('Hotel Buscable'));
    const { id, number } = await createQuote(shop.owner, { customerId: localCustomer });
    expect(
      (await listQuotes(shop.owner, { q: `COT-${number}` })).items.map((quote) => quote.id),
    ).toEqual([id]);
    expect(
      (await listQuotes(shop.owner, { q: 'buscable' })).items.map((quote) => quote.id),
    ).toEqual([id]);
    expect((await listCustomerQuotes(shop.owner, localCustomer)).map((quote) => quote.id)).toEqual([
      id,
    ]);
  });
});

describe('permessi e isolamento A ↔ B', () => {
  it('lo staff legge i preventivi senza costi e non li modifica', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '2' });
    const asStaff = await getQuote(shop.staff, id);
    expect(asStaff.lines[0]?.unitCostMinor).toBeNull();
    expect(asStaff).toMatchObject({
      canViewCosts: false,
      estimatedCostMinor: null,
      editable: false,
      allowedTransitions: [],
    });
    await expect(createQuote(shop.staff, { customerId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addCatalogItemToQuote(shop.staff, id, { catalogItemId: rose.id, quantity: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeQuoteStatus(shop.staff, id, 'SENT')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('B non legge, non modifica e non usa i preventivi o i clienti di A', async () => {
    const { id } = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
    const lineId = (await getQuote(shop.owner, id)).lines[0]!.id;

    expect((await listQuotes(other.owner, {})).items.map((quote) => quote.id)).not.toContain(id);
    await expect(getQuote(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addCustomLineToQuote(other.owner, id, {
        description: 'Intruso',
        quantity: '1',
        unitPrice: '1',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQuoteLineQuantity(other.owner, id, lineId, '99')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeQuoteLine(other.owner, id, lineId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQuoteDetails(other.owner, id, { discount: '1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(changeQuoteStatus(other.owner, id, 'CANCELLED')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createQuote(other.owner, { customerId })).rejects.toBeInstanceOf(NotFoundError);

    const quote = await getQuote(shop.owner, id);
    expect(quote).toMatchObject({ status: 'DRAFT', totalMinor: 3500 });
    expect(quote.lines).toHaveLength(1);
  });
});
