import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  MemoryMailer,
  NotFoundError,
  addCatalogItemToOrder,
  addCatalogItemToQuote,
  changeQuoteStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createOrderFromQuote,
  createQuote,
  getPublicOrder,
  sharePublicLink,
  type CatalogItemDto,
  type OrderMailDeps,
  type TenantContext,
} from '../src/index';
import { contextFor, createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Conferma per email al cliente degli ordini del banco (resti degli ordini, ADR-072): parte solo
 * con la casella, da una fioreria LIVE e se il cliente ha un'email; porta il link per seguirlo.
 */

const db = getDb();
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const STAMP = Date.now().toString(36);
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

let liveShop: TestShop;
let live: TenantContext;
let demo: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let demoRose: CatalogItemDto;
let anaId: string;
let anaEmail: string;
let noEmailId: string;
let demoCustomerId: string;
let tomorrow: string;

function customer(name: string, email: string | null) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email,
    phone: '+524495550142',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

function pickup(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

async function draftFor(ctx: TenantContext, customerId: string, item: CatalogItemDto) {
  const { id } = await createDraftOrder(ctx, { customerId });
  await addCatalogItemToOrder(ctx, id, { catalogItemId: item.id, quantity: '2' });
  return id;
}

async function acceptedQuote(ctx: TenantContext, customerId: string, item: CatalogItemDto) {
  const { id } = await createQuote(ctx, { customerId });
  await addCatalogItemToQuote(ctx, id, { catalogItemId: item.id, quantity: '3' });
  await changeQuoteStatus(ctx, id, 'SENT');
  await changeQuoteStatus(ctx, id, 'ACCEPTED');
  return id;
}

async function auditFor(ctx: TenantContext, action: string, entityId: string) {
  return withTenantContext(db, ctx, (tx) =>
    tx.auditLog.findFirst({ where: { tenantId: ctx.tenantId, action, entityId } }),
  );
}

async function activeLinks(ctx: TenantContext, orderId: string) {
  return withTenantContext(db, ctx, (tx) =>
    tx.publicLink.count({ where: { tenantId: ctx.tenantId, orderId, revokedAt: null } }),
  );
}

/** Il token del link "Ver mi pedido" nell'email. */
function trackingToken(text: string): string {
  const match = /\/pedido\/([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('link di tracciamento mancante');
  return match[1];
}

beforeAll(async () => {
  liveShop = await createTestShop('Florería Mostrador');
  await withSystemContext(db, { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: liveShop.tenant.tenantId },
      data: { mode: 'LIVE', contactEmail: `contacto-${STAMP}@mostrador.example.test` },
    }),
  );
  live = await contextFor(liveShop.tenant.owner.id, liveShop.tenant.slug);
  demo = await createTestShop('Florería Demo Mostrador');
  other = await createTestShop('Florería Ajena Mostrador');
  rose = await createCatalogItem(live, itemInput({ name: 'Rosa roja', priceMinor: 3500 }));
  demoRose = await createCatalogItem(demo.owner, itemInput({ name: 'Rosa roja' }));
  anaEmail = `ana-${STAMP}@mostrador.example.test`;
  anaId = (await createCustomer(live, customer('Ana Mostrador', anaEmail))).id;
  noEmailId = (await createCustomer(live, customer('Beto Sin Correo', null))).id;
  demoCustomerId = (
    await createCustomer(
      demo.owner,
      customer('Carla Demo', `carla-${STAMP}@mostrador.example.test`),
    )
  ).id;
  const today = todayInTimeZone(live.timezone);
  tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
    .toISOString()
    .slice(0, 10);
});

afterAll(async () => {
  await disconnectDb();
});

describe('conferma al cliente di un ordine del banco', () => {
  it('confermando il borrador con la casella il cliente riceve il riepilogo e il link', async () => {
    const orderId = await draftFor(live, anaId, rose);
    mailer.sent.length = 0;
    const result = await confirmDraftOrder(live, orderId, pickup({ notifyCustomer: 'on' }), deps);
    expect(result).toEqual({ customerNotified: true });

    expect(mailer.sent).toHaveLength(1);
    const message = mailer.lastTo(anaEmail);
    expect(message).toMatchObject({
      category: 'counter_order_confirmed',
      fromName: 'Florería Mostrador',
      replyTo: `contacto-${STAMP}@mostrador.example.test`,
    });
    expect(message?.subject).toMatch(/^Florería Mostrador confirmó tu pedido PED-\d+$/);
    expect(message?.text).toContain('recoger en la tienda');
    expect(message?.text).toContain('Total: $70.00');

    // Il link dell'email apre la pagina pubblica dell'ordine.
    const tracking = await getPublicOrder(SECRET, trackingToken(message?.text ?? ''));
    expect(tracking).toMatchObject({ status: 'CONFIRMED' });
    expect(await activeLinks(live, orderId)).toBe(1);

    // L'audit ricorda l'invio, senza l'indirizzo email.
    const audit = await auditFor(live, 'order.confirmed', orderId);
    expect(audit?.metadata).toMatchObject({ customerNotified: true });
    expect(JSON.stringify(audit?.metadata)).not.toContain('@');
  });

  it('da un preventivo accettato: email e "Compartir enlace" usano lo stesso link', async () => {
    const quoteId = await acceptedQuote(live, anaId, rose);
    mailer.sent.length = 0;
    const order = await createOrderFromQuote(live, quoteId, pickup({ notifyCustomer: 'on' }), deps);
    expect(order.customerNotified).toBe(true);

    const message = mailer.lastTo(anaEmail);
    expect(message?.category).toBe('counter_order_confirmed');
    expect(message?.text).toContain('Total: $105.00');
    const shared = await sharePublicLink(live, SECRET, { kind: 'ORDER', id: order.id });
    expect(trackingToken(message?.text ?? '')).toBe(shared.token);
    expect(await activeLinks(live, order.id)).toBe(1);
    expect((await auditFor(live, 'order.created', order.id))?.metadata).toMatchObject({
      customerNotified: true,
    });
  });

  it('senza la casella o senza email del cliente non parte niente', async () => {
    mailer.sent.length = 0;
    const unticked = await draftFor(live, anaId, rose);
    expect(await confirmDraftOrder(live, unticked, pickup(), deps)).toEqual({
      customerNotified: false,
    });
    const noEmail = await draftFor(live, noEmailId, rose);
    expect(await confirmDraftOrder(live, noEmail, pickup({ notifyCustomer: 'on' }), deps)).toEqual({
      customerNotified: false,
    });

    expect(mailer.sent).toHaveLength(0);
    // Nessun link creato al posto del fiorista.
    expect(await activeLinks(live, unticked)).toBe(0);
    expect(await activeLinks(live, noEmail)).toBe(0);
    expect((await auditFor(live, 'order.confirmed', noEmail))?.metadata).not.toHaveProperty(
      'customerNotified',
    );
  });

  it('una fioreria demo non scrive mai ai clienti (ADR-016)', async () => {
    mailer.sent.length = 0;
    const draft = await draftFor(demo.owner, demoCustomerId, demoRose);
    expect(
      await confirmDraftOrder(demo.owner, draft, pickup({ notifyCustomer: 'on' }), deps),
    ).toEqual({ customerNotified: false });
    const quoteId = await acceptedQuote(demo.owner, demoCustomerId, demoRose);
    const order = await createOrderFromQuote(
      demo.owner,
      quoteId,
      pickup({ notifyCustomer: 'on' }),
      deps,
    );
    expect(order.customerNotified).toBe(false);
    expect(mailer.sent).toHaveLength(0);
  });

  it('un’altra fioreria non conferma il borrador e non fa partire email (isolamento)', async () => {
    const draft = await draftFor(live, anaId, rose);
    mailer.sent.length = 0;
    await expect(
      confirmDraftOrder(other.owner, draft, pickup({ notifyCustomer: 'on' }), deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mailer.sent).toHaveLength(0);
    expect(await activeLinks(live, draft)).toBe(0);
  });
});
