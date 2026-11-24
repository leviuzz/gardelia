import { describe, expect, it } from 'vitest';
import {
  accountRoutes,
  buyerRoutes,
  isAccountPath,
  legalRoutes,
  publicStoreRoutes,
  tenantRoutes,
  withQuery,
} from '@/lib/routes';

describe('percorsi della fioreria (routes.ts)', () => {
  const routes = tenantRoutes('las-camelias');

  it('costruisce le pagine principali dallo slug', () => {
    expect(routes.home).toBe('/app/las-camelias');
    expect(routes.catalog.list()).toBe('/app/las-camelias/catalog');
    expect(routes.catalog.new).toBe('/app/las-camelias/catalog/new');
    expect(routes.customers.detail('c1')).toBe('/app/las-camelias/customers/c1');
    expect(routes.quotes.detail('q1')).toBe('/app/las-camelias/quotes/q1');
    expect(routes.builder.design('d1')).toBe('/app/las-camelias/builder/d1');
    expect(routes.builder.references).toBe('/app/las-camelias/builder/references');
    expect(routes.settings.general).toBe('/app/las-camelias/settings');
    expect(routes.settings.team).toBe('/app/las-camelias/settings/team');
    expect(routes.settings.plan).toBe('/app/las-camelias/settings/plan');
  });

  it('inventario: existencias, prodotti da controllare, scheda e movimenti (ADR-060)', () => {
    expect(routes.inventory.list()).toBe('/app/las-camelias/inventory');
    expect(routes.inventory.list({ status: 'LOW', archived: false })).toBe(
      '/app/las-camelias/inventory?status=LOW',
    );
    expect(routes.inventory.start({ q: 'Rosa roja' })).toBe(
      '/app/las-camelias/inventory/start?q=Rosa+roja',
    );
    expect(routes.inventory.item('i/1')).toBe('/app/las-camelias/inventory/i%2F1');
    expect(routes.inventory.movements({ kind: 'WASTE', page: 2 })).toBe(
      '/app/las-camelias/inventory/movements?kind=WASTE&page=2',
    );
    expect(routes.inventory.purchases({ q: 'jamaica' })).toBe(
      '/app/las-camelias/inventory/purchases?q=jamaica',
    );
    expect(routes.inventory.newPurchase()).toBe('/app/las-camelias/inventory/purchases/new');
    // "Por pedir" (ADR-081): la compra nasce con proveedor e prodotti già scelti.
    expect(routes.inventory.newPurchase({ proveedor: 'p1', productos: 'a,b' })).toBe(
      '/app/las-camelias/inventory/purchases/new?proveedor=p1&productos=a%2Cb',
    );
    expect(routes.inventory.restock()).toBe('/app/las-camelias/inventory/restock');
    expect(routes.inventory.purchase('e1', { created: true })).toBe(
      '/app/las-camelias/inventory/purchases/e1?created=1',
    );
    expect(routes.inventory.suppliers({ archived: true })).toBe(
      '/app/las-camelias/inventory/suppliers?archived=1',
    );
    expect(routes.inventory.reservations({ view: 'expired', q: 'boda' })).toBe(
      '/app/las-camelias/inventory/reservations?view=expired&q=boda',
    );
    expect(routes.inventory.newReservation({ item: 'i1' })).toBe(
      '/app/las-camelias/inventory/reservations/new?item=i1',
    );
    expect(routes.inventory.reservation('r/1', { created: true })).toBe(
      '/app/las-camelias/inventory/reservations/r%2F1?created=1',
    );
  });

  it('la query contiene solo i valori presenti, nell’ordine dato', () => {
    expect(
      routes.catalog.list({ q: 'rosa roja', type: undefined, status: 'ARCHIVED', page: 2 }),
    ).toBe('/app/las-camelias/catalog?q=rosa+roja&status=ARCHIVED&page=2');
    expect(routes.builder.list({ archived: false, page: undefined })).toBe(
      '/app/las-camelias/builder',
    );
    expect(routes.builder.list({ archived: true })).toBe('/app/las-camelias/builder?archived=1');
    expect(routes.catalog.item('i1', { created: true })).toBe(
      '/app/las-camelias/catalog/i1?created=1',
    );
    // Passi dopo la creazione guidata di un prodotto: foto, poi "listo".
    expect(routes.catalog.added('i1')).toBe('/app/las-camelias/catalog/new/i1');
    expect(routes.catalog.added('i1', { step: 'done' })).toBe(
      '/app/las-camelias/catalog/new/i1?step=done',
    );
  });

  it('codifica i valori: un nome con & o # non rompe il link', () => {
    expect(routes.quotes.list({ q: 'Ana & Luis #2' })).toBe(
      '/app/las-camelias/quotes?q=Ana+%26+Luis+%232',
    );
    expect(routes.quotes.new({ customerId: 'c1', configurationId: null })).toBe(
      '/app/las-camelias/quotes/new?customerId=c1',
    );
    expect(routes.quotes.new()).toBe('/app/las-camelias/quotes/new');
  });

  it('un ID manomesso resta un solo segmento del percorso', () => {
    expect(routes.quotes.detail('../settings')).toBe('/app/las-camelias/quotes/..%2Fsettings');
    expect(routes.catalog.item('a/b?c')).toBe('/app/las-camelias/catalog/a%2Fb%3Fc');
  });

  it('immagini: la versione grande non porta ?size, le altre sì', () => {
    expect(routes.catalog.photo('p1')).toBe('/app/las-camelias/catalog/photos/p1');
    expect(routes.catalog.photo('p1', 'cutout-thumb')).toBe(
      '/app/las-camelias/catalog/photos/p1?size=cutout-thumb',
    );
    expect(routes.builder.referencePhoto('r1', 'thumb')).toBe(
      '/app/las-camelias/builder/references/r1?size=thumb',
    );
    expect(routes.builder.sketch('d1', 3)).toBe('/app/las-camelias/builder/d1/sketch?v=3');
    expect(routes.builder.preview('j1')).toBe('/app/las-camelias/builder/previews/j1');
    expect(routes.quotes.lineImage('q1', 'l1')).toBe('/app/las-camelias/quotes/q1/lines/l1/image');
    expect(routes.quotes.lineImage('q1', 'l1', { download: true })).toBe(
      '/app/las-camelias/quotes/q1/lines/l1/image?download=1',
    );
    expect(routes.orders.lineImage('o1', 'l1', { download: true })).toBe(
      '/app/las-camelias/orders/o1/lines/l1/image?download=1',
    );
    expect(routes.orders.new()).toBe('/app/las-camelias/orders/new');
    expect(routes.orders.new({ customerId: 'c1', configurationId: null })).toBe(
      '/app/las-camelias/orders/new?customerId=c1',
    );
  });

  it('withQuery senza valori lascia il percorso com’è', () => {
    expect(withQuery('/x')).toBe('/x');
    expect(withQuery('/x', { a: '', b: null, c: undefined, d: false })).toBe('/x');
    expect(withQuery('/x', { n: 0 })).toBe('/x?n=0');
  });
});

describe('conto del cliente (routes.ts)', () => {
  it('riconosce le destinazioni di "Mi cuenta" e nient\'altro', () => {
    expect(accountRoutes.home).toBe('/cuenta');
    expect(isAccountPath('/cuenta')).toBe(true);
    expect(isAccountPath('/cuenta/direcciones')).toBe(true);
    expect(isAccountPath('/cuentas')).toBe(false);
    expect(isAccountPath('/app')).toBe(false);
    expect(isAccountPath('/onboarding')).toBe(false);
  });

  it('"Hacer pedido" in una tienda è una destinazione di chi compra (ADR-067)', () => {
    const store = publicStoreRoutes('las-camelias');
    expect(store.checkout()).toBe('/f/las-camelias/pedido');
    expect(store.checkout({ producto: 'p1' })).toBe('/f/las-camelias/pedido?producto=p1');
    expect(isAccountPath(store.checkout())).toBe(true);
    expect(isAccountPath(store.checkout({ producto: 'p1' }))).toBe(true);
    expect(isAccountPath(store.home)).toBe(false);
    expect(isAccountPath('/f/las-camelias/pedidos')).toBe(false);
    expect(buyerRoutes.fromSearch('las-camelias')).toBe('/buscar/ir/las-camelias');
  });

  it('privacy di chi compra e documenti legali (ADR-068)', () => {
    expect(accountRoutes.deleteConfirm('abc123')).toBe('/cuenta/eliminar?token=abc123');
    expect(isAccountPath(accountRoutes.deleteConfirm('abc123'))).toBe(true);
    expect(isAccountPath(accountRoutes.data)).toBe(true);
    // Dopo la cancellazione non c'è più sessione: pagina pubblica, fuori da "Mi cuenta".
    expect(isAccountPath(accountRoutes.deleted)).toBe(false);
    expect(Object.values(legalRoutes)).toEqual([
      '/privacidad',
      '/terminos',
      '/terminos/compradores',
    ]);
  });
});
