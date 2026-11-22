import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { addDays, todayInTimeZone, toIsoDate, type CalendarDate } from '@floral/domain';
import {
  ForbiddenError,
  MemoryMailer,
  ValidationError,
  createCustomer,
  createUnsubscribeToken,
  describeUnsubscribe,
  getCustomer,
  getOccasionPromo,
  listCalendarOccasions,
  previewOccasionPromoEmail,
  runOccasionPromos,
  setCustomerArchived,
  unsubscribeFromPromotions,
  updateOccasionPromo,
  type EmailMessage,
  type Mailer,
  type TenantContext,
} from '../src/index';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

/**
 * Promo delle date speciali (ADR-047): impostazioni, email automatica solo a chi ha email e
 * consenso, una sola email per data, mai dalle fiorerie demo, ripetizione dopo un fallimento,
 * disiscrizione dal link firmato e isolamento fra fiorerie.
 */
const SECRET = 'test-secret-for-promo-links-0123456789abcdef';
const APP_URL = 'https://app.example.test';
const TZ = 'America/Mexico_City';
const NOW = new Date();
const TODAY = todayInTimeZone(TZ, NOW);
const STAMP = `${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function on(date: CalendarDate) {
  return { month: date.month, day: date.day };
}

function address(name: string) {
  return `${name}-${STAMP}@promo.example.test`;
}

function customer(name: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: address(name.toLowerCase()),
    phone: null,
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: true,
    ...overrides,
  };
}

/** Email di questa esecuzione dei test (il database dei test è condiviso fra le esecuzioni). */
function mine(mailer: MemoryMailer): EmailMessage[] {
  return mailer.sent.filter((message) => message.to.endsWith(`-${STAMP}@promo.example.test`));
}

async function makeLive(shop: TestShop, contact: { email?: string; phone?: string } = {}) {
  await withSystemContext(getDb(), { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: shop.tenant.tenantId },
      data: {
        mode: 'LIVE',
        contactEmail: contact.email ?? null,
        contactPhone: contact.phone ?? null,
      },
    }),
  );
  return contextFor(shop.tenant.owner.id, shop.tenant.slug);
}

async function promoRows(ctx: TenantContext, customerId: string) {
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.occasionPromoEmail.findMany({
      where: { tenantId: ctx.tenantId, customerId },
      orderBy: { occurrenceDate: 'asc' },
    }),
  );
}

const run = (mailer: Mailer, now: Date = NOW) =>
  runOccasionPromos({ mailer, appUrl: APP_URL, secret: SECRET, now });

let live: TestShop;
let owner: TenantContext;
let demo: TestShop;
let other: TestShop;
let otherOwner: TenantContext;
const ids: Record<string, string> = {};

beforeAll(async () => {
  live = await createTestShop('Florería Promo Viva');
  owner = await makeLive(live, { email: 'hola@viva.test', phone: '+524495550111' });
  demo = await createTestShop('Florería Promo Demo');
  other = await createTestShop('Florería Promo B');
  otherOwner = await makeLive(other);

  const create = async (key: string, shopOwner: TenantContext, input: Record<string, unknown>) => {
    ids[key] = (await createCustomer(shopOwner, input)).id;
  };
  // Fra 7 giorni, preavviso predefinito (7): parte oggi.
  await create('ana', owner, {
    ...customer('Ana'),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 7)), year: 1990 }],
  });
  // Due date vicine dello stesso cliente: un'unica email.
  await create('beto', owner, {
    ...customer('Beto'),
    occasions: [
      { type: 'BIRTHDAY', ...on(addDays(TODAY, 5)) },
      { type: 'CUSTOM', label: 'Día de la boda', ...on(addDays(TODAY, 6)) },
    ],
  });
  // Senza consenso, senza email, troppo lontana, archiviato: niente email.
  await create('carla', owner, {
    ...customer('Carla', { marketingConsent: false }),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 3)) }],
  });
  await create('dario', owner, {
    ...customer('Dario', { email: null }),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 3)) }],
  });
  await create('elena', owner, {
    ...customer('Elena'),
    occasions: [{ type: 'ANNIVERSARY', ...on(addDays(TODAY, 20)) }],
  });
  await create('fede', owner, {
    ...customer('Fede'),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 2)) }],
  });
  await setCustomerArchived(owner, ids.fede!, true);
  // Fioreria demo con un cliente pronto: non deve partire nulla.
  await create('demo', demo.owner, {
    ...customer('Demo'),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 1)) }],
  });
  // Altra fioreria reale (isolamento).
  await create('otro', otherOwner, {
    ...customer('Otro'),
    occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 4)) }],
  });
});

afterAll(async () => {
  // Il database dei test resta fra un'esecuzione e l'altra: le promo di qui si spengono.
  await withSystemContext(getDb(), { reason: 'test: spegne le promo' }, (tx) =>
    tx.tenant.updateMany({
      where: { id: { in: [live.tenant.tenantId, demo.tenant.tenantId, other.tenant.tenantId] } },
      data: { occasionPromoEnabled: false },
    }),
  );
  await disconnectDb();
});

describe('impostazioni della promo', () => {
  it('solo proprietario e manager; attivarla richiede lo sconto', async () => {
    await expect(getOccasionPromo(live.staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateOccasionPromo(live.staff, { enabled: 'on', kind: 'PERCENT', percent: '10' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateOccasionPromo(owner, { enabled: 'on', kind: 'PERCENT', percent: '' }),
    ).rejects.toBeInstanceOf(ValidationError);

    const initial = await getOccasionPromo(owner);
    expect(initial.settings).toEqual({ enabled: false, kind: 'PERCENT', value: null });
    expect(initial.mode).toBe('LIVE');
    expect(initial.hasContact).toBe(true);
    // Clienti attivi con date: Ana, Beto, Carla, Dario, Elena; con email e consenso: 3.
    expect(initial.reach).toEqual({ customersWithDates: 5, reachable: 3 });
    expect(await previewOccasionPromoEmail(owner)).toBeNull();
  });

  it("si salva con l'audit e l'anteprima mostra lo sconto", async () => {
    await updateOccasionPromo(live.manager, { enabled: 'on', kind: 'PERCENT', percent: '15' });
    const view = await getOccasionPromo(owner);
    expect(view.settings).toEqual({ enabled: true, kind: 'PERCENT', value: 15 });

    const audit = await withTenantContext(getDb(), owner, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: owner.tenantId, action: 'tenant.promo_updated' },
      }),
    );
    expect(audit?.metadata).toMatchObject({
      changes: { occasionPromoEnabled: { from: false, to: true } },
    });

    const preview = await previewOccasionPromoEmail(owner);
    expect(preview?.subject).toBe('15% de descuento para tu cumpleaños');
    expect(preview?.text).toContain('Hola, María:');
    expect(preview?.fromName).toBe('Florería Promo Viva');
  });
});

describe('email automatica delle date speciali', () => {
  const mailer = new MemoryMailer();

  it('parte solo per chi ha email e consenso, entro il preavviso; una email per cliente', async () => {
    await updateOccasionPromo(demo.owner, { enabled: 'on', kind: 'AMOUNT', amount: '100' });
    await updateOccasionPromo(otherOwner, { enabled: 'on', kind: 'AMOUNT', amount: '50' });
    await run(mailer);

    const sent = mine(mailer);
    expect(sent.map((message) => message.to).sort()).toEqual(
      [address('ana'), address('beto'), address('otro')].sort(),
    );

    const ana = sent.find((message) => message.to === address('ana'))!;
    expect(ana.subject).toBe('15% de descuento para tu cumpleaños');
    expect(ana.fromName).toBe('Florería Promo Viva');
    expect(ana.replyTo).toBe('hola@viva.test');
    expect(ana.text).toContain('Hola, Ana:');
    expect(ana.text).toContain('https://wa.me/524495550111?text=');
    expect(ana.headers?.['List-Unsubscribe']).toMatch(
      /^<https:\/\/app\.example\.test\/api\/unsubscribe\/[A-Za-z0-9_-]{64}>$/,
    );
    expect(ana.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const beto = sent.find((message) => message.to === address('beto'))!;
    expect(beto.subject).toBe('15% de descuento para tus fechas especiales');
    expect(beto.text).toContain('- tu cumpleaños, el ');
    expect(beto.text).toContain('- Día de la boda, el ');

    // L'altra fioreria scrive col suo nome e il suo sconto, senza contatti propri.
    const otro = sent.find((message) => message.to === address('otro'))!;
    expect(otro.subject).toBe('$50.00 de descuento para tu cumpleaños');
    expect(otro.fromName).toBe('Florería Promo B');
    expect(otro.replyTo).toBeUndefined();

    const rows = await promoRows(owner, ids.beto!);
    expect(rows.map((row) => [row.status, row.attempts, row.discountValue])).toEqual([
      ['SENT', 1, 15],
      ['SENT', 1, 15],
    ]);
  });

  it('una seconda esecuzione non rimanda nulla', async () => {
    const before = mine(mailer).length;
    await run(mailer);
    await run(mailer, new Date(NOW.getTime() + DAY_MS));
    expect(mine(mailer)).toHaveLength(before);
  });

  it('il calendario dice per ogni data com’è andata o quando partirà', async () => {
    const events = await listCalendarOccasions(owner, {
      from: TODAY,
      to: addDays(TODAY, 30),
    });
    const promoOf = (name: string) =>
      events.find((event) => event.customerName === name)?.promo ?? null;
    expect(promoOf('Ana')).toMatchObject({ status: 'SENT' });
    expect(promoOf('Carla')).toEqual({ status: 'NO_CONSENT' });
    expect(promoOf('Dario')).toEqual({ status: 'NO_EMAIL' });
    expect(promoOf('Elena')).toEqual({
      status: 'SCHEDULED',
      sendOn: toIsoDate(addDays(TODAY, 13)),
    });
  });

  it('se l’invio fallisce si riprova nei giorni seguenti, fino a 3 volte', async () => {
    const gina = await createCustomer(owner, {
      ...customer('Gina'),
      occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 6)) }],
    });
    const failing: Mailer = {
      kind: 'memory',
      send: async (message) => {
        if (message.to === address('gina')) throw new Error('smtp down');
      },
    };
    await run(failing);
    await run(failing, new Date(NOW.getTime() + DAY_MS));
    expect((await promoRows(owner, gina.id)).map((row) => [row.status, row.attempts])).toEqual([
      ['FAILED', 2],
    ]);
    // Terzo tentativo riuscito; poi nulla più.
    const retry = new MemoryMailer();
    await run(retry, new Date(NOW.getTime() + 2 * DAY_MS));
    await run(retry, new Date(NOW.getTime() + 3 * DAY_MS));
    expect(mine(retry).map((message) => message.to)).toEqual([address('gina')]);
    const [row] = await promoRows(owner, gina.id);
    expect([row?.status, row?.attempts, row?.lastError]).toEqual(['SENT', 3, null]);
  });

  it('un invio interrotto a metà non si ripete (mai due email uguali)', async () => {
    const hugo = await createCustomer(owner, {
      ...customer('Hugo'),
      occasions: [{ type: 'BIRTHDAY', ...on(addDays(TODAY, 4)) }],
    });
    const occasion = await withTenantContext(getDb(), owner, (tx) =>
      tx.customerOccasion.findFirstOrThrow({
        where: { tenantId: owner.tenantId, customerId: hugo.id },
      }),
    );
    const date = addDays(TODAY, 4);
    await withSystemContext(getDb(), { reason: 'test: invio interrotto' }, async (tx) => {
      const row = await tx.occasionPromoEmail.create({
        data: {
          tenantId: owner.tenantId,
          occasionId: occasion.id,
          customerId: hugo.id,
          occurrenceDate: new Date(Date.UTC(date.year, date.month - 1, date.day)),
          discountKind: 'PERCENT',
          discountValue: 15,
          currency: 'MXN',
        },
      });
      await tx.$executeRaw`UPDATE "OccasionPromoEmail" SET "updatedAt" = now() - interval '2 hours' WHERE id = ${row.id}::uuid`;
    });
    const later = new MemoryMailer();
    await run(later);
    expect(mine(later)).toEqual([]);
    const [row] = await promoRows(owner, hugo.id);
    expect([row?.status, row?.attempts, row?.lastError]).toEqual(['FAILED', 3, 'interrupted']);
  });
});

describe('disiscrizione dal link dell’email', () => {
  it('il cliente toglie il consenso; il link vale solo per lui', async () => {
    const token = createUnsubscribeToken(SECRET, {
      tenantId: owner.tenantId,
      customerId: ids.ana!,
    });
    expect(await describeUnsubscribe(SECRET, token)).toEqual({
      shopName: 'Florería Promo Viva',
      locale: 'es-MX',
      subscribed: true,
    });

    // Link alterato, segreto sbagliato, cliente di un'altra fioreria: non valgono.
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await describeUnsubscribe(SECRET, tampered)).toBeNull();
    expect(await describeUnsubscribe('another-secret-0123456789abcdef', token)).toBeNull();
    expect(await describeUnsubscribe(SECRET, 'not-a-token')).toBeNull();
    const crossTenant = createUnsubscribeToken(SECRET, {
      tenantId: owner.tenantId,
      customerId: ids.otro!,
    });
    expect(await unsubscribeFromPromotions(SECRET, crossTenant)).toBeNull();
    expect((await getCustomer(otherOwner, ids.otro!)).marketingConsent).toBe(true);

    expect(await unsubscribeFromPromotions(SECRET, token)).toMatchObject({ subscribed: false });
    expect(await unsubscribeFromPromotions(SECRET, token)).toMatchObject({ subscribed: false });
    expect((await getCustomer(owner, ids.ana!)).marketingConsent).toBe(false);
    const audits = await withTenantContext(getDb(), owner, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: owner.tenantId, action: 'customer.unsubscribed', entityId: ids.ana! },
      }),
    );
    expect(audits.map((audit) => audit.actorUserId)).toEqual([null]);
  });

  it('le impostazioni di una fioreria non si vedono dall’altra', async () => {
    expect((await getOccasionPromo(otherOwner)).settings).toEqual({
      enabled: true,
      kind: 'AMOUNT',
      value: 5000,
    });
    expect((await getOccasionPromo(owner)).settings.value).toBe(15);
  });
});
