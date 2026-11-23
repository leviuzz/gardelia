import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  NotFoundError,
  acceptPublicQuote,
  addCatalogItemToQuote,
  cancelOrder,
  changeQuoteStatus,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createOrderFromQuote,
  createQuote,
  createUnsubscribeToken,
  getPublicLink,
  getPublicLineImage,
  getPublicOrder,
  getPublicQuote,
  getQuote,
  revokePublicLink,
  sharePublicLink,
  updateQuoteDetails,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/** Link pubblici di preventivi e ordini (ADR-056). */

const db = getDb();
const SECRET = 'test-secret-for-public-links-0123456789';
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;
let tomorrow: string;

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

/** Preventivo inviato: 10 rose (10 × 35,00 = 350,00). */
async function sentQuote(validUntil = '') {
  const { id } = await createQuote(shop.owner, { customerId });
  await addCatalogItemToQuote(shop.owner, id, { catalogItemId: rose.id, quantity: '10' });
  await updateQuoteDetails(shop.owner, id, {
    title: 'Ramo de aniversario',
    notes: 'Entrega en caja',
    discount: '',
    validUntil,
  });
  await changeQuoteStatus(shop.owner, id, 'SENT');
  return id;
}

function pickup() {
  return {
    fulfillmentMode: 'PICKUP',
    scheduledDate: tomorrow,
    windowStart: '',
    windowEnd: '',
    customerAddressId: '',
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '¡Felicidades!',
    cardSignature: 'Ana',
    deliveryFee: '',
    notes: 'Nota interna: cliente frecuente',
  };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Enlaces');
  other = await createTestShop('Florería Enlaces Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Ana Torres',
      legalName: null,
      taxId: null,
      email: null,
      phone: '+524495550142',
      notes: 'privado',
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: null,
      marketingConsent: false,
    })
  ).id;
  tomorrow = isoDate(1);
});

afterAll(async () => {
  await disconnectDb();
});

describe('link del preventivo', () => {
  it('si condivide da inviato; il cliente lo vede senza costi e lo accetta una volta', async () => {
    const quoteId = await sentQuote();
    const target = { kind: 'QUOTE', id: quoteId } as const;
    const link = await sharePublicLink(shop.manager, SECRET, target);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    // Lo stesso link finché è attivo: il fiorista lo ricopia quando vuole.
    expect((await sharePublicLink(shop.owner, SECRET, target)).token).toBe(link.token);
    expect((await getPublicLink(shop.owner, SECRET, target))?.token).toBe(link.token);

    const view = await getPublicQuote(SECRET, link.token);
    expect(view).toMatchObject({
      status: 'SENT',
      title: 'Ramo de aniversario',
      notes: 'Entrega en caja',
      customerName: 'Ana Torres',
      totalMinor: 35000,
      canAccept: true,
      acceptedAt: null,
      shop: { name: 'Florería Enlaces', locale: 'es-MX' },
    });
    expect(view?.lines).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/cost|Cost|1400|privado/);

    expect(await acceptPublicQuote(SECRET, link.token, { requestId: 'req-1' })).toBe('accepted');
    expect((await getQuote(shop.owner, quoteId)).status).toBe('ACCEPTED');
    expect(await acceptPublicQuote(SECRET, link.token)).toBe('unavailable');
    const after = await getPublicQuote(SECRET, link.token);
    expect(after).toMatchObject({ status: 'ACCEPTED', canAccept: false });
    expect(after?.acceptedAt).toBeInstanceOf(Date);

    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          entityId: quoteId,
          action: { in: ['quote.accepted_online', 'public_link.created'] },
        },
        select: { action: true, actorUserId: true, tenantId: true, requestId: true },
      }),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        {
          action: 'quote.accepted_online',
          actorUserId: null,
          tenantId: shop.tenant.tenantId,
          requestId: 'req-1',
        },
        expect.objectContaining({
          action: 'public_link.created',
          actorUserId: shop.managerUser.id,
        }),
      ]),
    );
  });

  it('la bozza non si condivide; uno scaduto si vede ma non si accetta', async () => {
    const { id: draftId } = await createQuote(shop.owner, { customerId });
    await expect(
      sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: draftId }),
    ).rejects.toMatchObject({ reason: 'public_link_unavailable' });

    const quoteId = await sentQuote(isoDate(1));
    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    // Scade la validità: il link mostra "vencida" e non accetta più.
    await withTenantContext(db, shop.owner, (tx) =>
      tx.quote.update({
        where: { id: quoteId },
        data: { validUntil: new Date(`${isoDate(-1)}T00:00:00Z`) },
      }),
    );
    expect(await getPublicQuote(SECRET, link.token)).toMatchObject({
      status: 'EXPIRED',
      canAccept: false,
    });
    expect(await acceptPublicQuote(SECRET, link.token)).toBe('unavailable');
    expect((await getQuote(shop.owner, quoteId)).status).toBe('EXPIRED');
  });

  it('rinnovato o disattivato, il vecchio link non vale più; e scade da solo', async () => {
    const quoteId = await sentQuote();
    const target = { kind: 'QUOTE', id: quoteId } as const;
    const first = await sharePublicLink(shop.owner, SECRET, target);
    const renewed = await sharePublicLink(shop.owner, SECRET, target, { renew: true });
    expect(renewed.token).not.toBe(first.token);
    expect(await getPublicQuote(SECRET, first.token)).toBeNull();
    expect(await getPublicQuote(SECRET, renewed.token)).not.toBeNull();

    await revokePublicLink(shop.owner, target);
    expect(await getPublicQuote(SECRET, renewed.token)).toBeNull();
    expect(await acceptPublicQuote(SECRET, renewed.token)).toBeNull();
    expect(await getPublicLink(shop.owner, SECRET, target)).toBeNull();

    const fresh = await sharePublicLink(shop.owner, SECRET, target);
    await withTenantContext(db, shop.owner, (tx) =>
      tx.publicLink.updateMany({
        where: { tenantId: shop.tenant.tenantId, quoteId, revokedAt: null },
        data: {
          createdAt: new Date(Date.now() - 61 * 24 * 3600 * 1000),
          expiresAt: new Date(Date.now() - 1000),
        },
      }),
    );
    expect(await getPublicQuote(SECRET, fresh.token)).toBeNull();
    // Scaduto: "Compartir" ne crea uno nuovo.
    const next = await sharePublicLink(shop.owner, SECRET, target);
    expect(next.token).not.toBe(fresh.token);
    expect(await getPublicQuote(SECRET, next.token)).not.toBeNull();
  });

  it('token falsi, di un altro scopo o di un altro tipo non aprono nulla', async () => {
    const quoteId = await sentQuote();
    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    const tampered = `${link.token.slice(0, -2)}${link.token.endsWith('AA') ? 'AB' : 'AA'}`;
    expect(await getPublicQuote(SECRET, tampered)).toBeNull();
    expect(await getPublicQuote('another-secret-0123456789abcdef', link.token)).toBeNull();
    expect(await getPublicQuote(SECRET, 'corto')).toBeNull();
    expect(await getPublicOrder(SECRET, link.token)).toBeNull();
    const unsubscribe = createUnsubscribeToken(SECRET, {
      tenantId: shop.tenant.tenantId,
      customerId,
    });
    expect(await getPublicQuote(SECRET, unsubscribe)).toBeNull();
  });
});

describe('link dell’ordine', () => {
  it('mostra stato, consegna, tarjeta e saldo, mai le note interne', async () => {
    const quoteId = await sentQuote();
    await changeQuoteStatus(shop.owner, quoteId, 'ACCEPTED');
    const { id: orderId } = await createOrderFromQuote(shop.owner, quoteId, pickup());
    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'ORDER', id: orderId });
    const view = await getPublicOrder(SECRET, link.token);
    expect(view).toMatchObject({
      status: 'CONFIRMED',
      fulfillmentMode: 'PICKUP',
      scheduledDate: tomorrow,
      cardMessage: '¡Felicidades!',
      cardSignature: 'Ana',
      totalMinor: 35000,
      paidMinor: 0,
      balanceMinor: 35000,
      deliveryAddress: null,
    });
    expect(view?.history.map((step) => step.status)).toEqual(['CONFIRMED']);
    expect(JSON.stringify(view)).not.toMatch(/Nota interna|cost|Cost/);
    expect(await getPublicQuote(SECRET, link.token)).toBeNull();

    // Annullato: il link resta e lo dice; uno nuovo non si crea.
    await cancelOrder(shop.owner, orderId, { reason: 'Cambio de planes' });
    expect(await getPublicOrder(SECRET, link.token)).toMatchObject({
      status: 'CANCELLED',
      balanceMinor: 0,
    });
    await expect(
      sharePublicLink(shop.owner, SECRET, { kind: 'ORDER', id: orderId }, { renew: true }),
    ).rejects.toMatchObject({ reason: 'public_link_unavailable' });
  });

  it('un borrador non si condivide', async () => {
    const { id } = await createDraftOrder(shop.owner, { customerId });
    await expect(sharePublicLink(shop.owner, SECRET, { kind: 'ORDER', id })).rejects.toMatchObject({
      reason: 'public_link_unavailable',
    });
  });

  it('immagini solo delle righe del documento del link', async () => {
    const quoteId = await sentQuote();
    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    const otherQuote = await getQuote(shop.owner, await sentQuote());
    // Riga di un altro preventivo, o riga senza immagine: niente.
    expect(
      await getPublicLineImage(SECRET, link.token, 'QUOTE', otherQuote.lines[0]!.id),
    ).toBeNull();
    const own = await getQuote(shop.owner, quoteId);
    expect(await getPublicLineImage(SECRET, link.token, 'QUOTE', own.lines[0]!.id)).toBeNull();
    expect(await getPublicLineImage(SECRET, link.token, 'ORDER', own.lines[0]!.id)).toBeNull();
  });
});

describe('permessi e isolamento', () => {
  it('lo staff non condivide né disattiva', async () => {
    const quoteId = await sentQuote();
    const target = { kind: 'QUOTE', id: quoteId } as const;
    await expect(sharePublicLink(shop.staff, SECRET, target)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getPublicLink(shop.staff, SECRET, target)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokePublicLink(shop.staff, target)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('un’altra fioreria non condivide né disattiva i documenti altrui', async () => {
    const quoteId = await sentQuote();
    const target = { kind: 'QUOTE', id: quoteId } as const;
    const link = await sharePublicLink(shop.owner, SECRET, target);
    await expect(sharePublicLink(other.owner, SECRET, target)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(revokePublicLink(other.owner, target)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getPublicLink(other.owner, SECRET, target)).toBeNull();
    expect(await getPublicQuote(SECRET, link.token)).not.toBeNull();
    const visible = await withTenantContext(db, other.owner, (tx) =>
      tx.publicLink.findMany({ where: { quoteId } }),
    );
    expect(visible).toEqual([]);
  });

  it('il database tiene un solo link attivo per documento', async () => {
    const quoteId = await sentQuote();
    await sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.publicLink.create({
          data: {
            tenantId: shop.tenant.tenantId,
            kind: 'QUOTE',
            quoteId,
            expiresAt: new Date(Date.now() + 1000 * 3600),
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.publicLink.create({
          data: {
            tenantId: shop.tenant.tenantId,
            kind: 'ORDER',
            quoteId,
            expiresAt: new Date(Date.now() + 1000 * 3600),
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
