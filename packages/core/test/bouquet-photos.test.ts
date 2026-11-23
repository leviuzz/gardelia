import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { AUDIT_ACTIONS, todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  addBouquetPhoto,
  changeQuoteStatus,
  createCatalogItem,
  createOrderFromQuote,
  createCustomer,
  createQuoteFromConfiguration,
  deleteBouquetConfiguration,
  getBouquetConfiguration,
  getBouquetPhotoImage,
  getOrder,
  getOrderLineImage,
  getQuote,
  getQuoteLineImage,
  listStyleReferences,
  removeBouquetPhoto,
  saveBouquetConfiguration,
  setBouquetConfigurationArchived,
  setObjectStorage,
  type CatalogItemDto,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Foto vera del ramo di un disegno (ADR-052): la carica chi usa il Diseñador, sostituisce la foto
 * AI nei preventivi, può entrare anche in "Mis ramos" (solo proprietario e manager, con il
 * consenso), e se ne va con il disegno eliminato.
 */

const db = getDb();
const storage = new MemoryStorage();
let operatorEmail: string;

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  return { shop, rose: await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' })) };
}

function saveDesign(kit: Kit, name = 'Ramo con foto') {
  return saveBouquetConfiguration(kit.shop.owner, {
    name,
    style: 'ROMANTIC',
    size: 'MEDIUM',
    budget: '',
    notes: '',
    lines: [{ catalogItemId: kit.rose.id, quantity: 6 }],
  });
}

async function photoBytes(color: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 800, height: 900, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

async function quoteFor(kit: Kit, configurationId: string) {
  const customer = await createCustomer(kit.shop.owner, {
    type: 'PERSON',
    displayName: 'Cliente Foto',
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
  });
  const quote = await createQuoteFromConfiguration(kit.shop.owner, {
    configurationId,
    customerId: customer.id,
  });
  const detail = await getQuote(kit.shop.owner, quote.id);
  return { quoteId: quote.id, line: detail.lines[0]! };
}

async function photoRows(configurationId: string) {
  return withSystemContext(db, { reason: 'test: foto del ramo' }, (tx) =>
    tx.bouquetPhoto.findMany({
      where: { configurationId },
      select: { id: true, status: true, storageKey: true, thumbKey: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Foto Ramo' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  setObjectStorage(storage);
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('foto vera del ramo', () => {
  it('la carica anche lo staff; va nei preventivi; cambiata, i preventivi tengono la loro', async () => {
    const kit = await createKit();
    const design = await saveDesign(kit);
    expect((await getBouquetConfiguration(kit.shop.staff, design.id)).photo).toBeNull();

    const first = await addBouquetPhoto(kit.shop.staff, design.id, await photoBytes('#aa2233'), {});
    expect(first.addedToReferences).toBe(false);
    expect((await getBouquetConfiguration(kit.shop.staff, design.id)).photo?.id).toBe(
      first.photo.id,
    );
    const full = await getBouquetPhotoImage(kit.shop.staff, first.photo.id, 'full');
    const thumb = await getBouquetPhotoImage(kit.shop.staff, first.photo.id, 'thumb');
    expect(full.contentType).toBe('image/jpeg');
    expect(thumb.bytes.length).toBeLessThan(full.bytes.length);

    // Il preventivo mostra la foto vera al posto dell'anteprima AI.
    const quoted = await quoteFor(kit, design.id);
    expect(quoted.line.image).toEqual({ source: 'photo', verified: false, simulated: false });
    const inQuote = await getQuoteLineImage(kit.shop.owner, quoted.quoteId, quoted.line.id);
    expect(Buffer.from(inQuote.bytes).equals(Buffer.from(full.bytes))).toBe(true);

    // Una foto nuova sostituisce la precedente, che resta solo al preventivo già fatto.
    const second = await addBouquetPhoto(
      kit.shop.staff,
      design.id,
      await photoBytes('#2244aa'),
      {},
    );
    expect((await photoRows(design.id)).map((row) => row.status)).toEqual(['ARCHIVED', 'ACTIVE']);
    await expect(
      getBouquetPhotoImage(kit.shop.staff, first.photo.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    const stillOld = await getQuoteLineImage(kit.shop.owner, quoted.quoteId, quoted.line.id);
    expect(Buffer.from(stillOld.bytes).equals(Buffer.from(full.bytes))).toBe(true);
    const newer = await quoteFor(kit, design.id);
    const newerImage = await getQuoteLineImage(kit.shop.owner, newer.quoteId, newer.line.id);
    const secondFull = await getBouquetPhotoImage(kit.shop.staff, second.photo.id, 'full');
    expect(Buffer.from(newerImage.bytes).equals(Buffer.from(secondFull.bytes))).toBe(true);

    // Tolta dal disegno: niente foto per i preventivi nuovi, quelli fatti la tengono.
    await removeBouquetPhoto(kit.shop.staff, design.id);
    expect((await getBouquetConfiguration(kit.shop.staff, design.id)).photo).toBeNull();
    expect((await quoteFor(kit, design.id)).line.image).toBeNull();
    expect((await getQuote(kit.shop.owner, newer.quoteId)).lines[0]?.image?.source).toBe('photo');

    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: design.id, action: { startsWith: 'builder.photo' } },
        select: { action: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.map((row) => row.action)).toEqual([
      AUDIT_ACTIONS.builderPhotoAdded,
      AUDIT_ACTIONS.builderPhotoAdded,
      AUDIT_ACTIONS.builderPhotoRemoved,
    ]);
  });

  it('con la casella entra anche in "Mis ramos", solo per proprietario e manager', async () => {
    const kit = await createKit();
    const design = await saveDesign(kit, 'Ramo romántico de rosas');
    const added = await addBouquetPhoto(kit.shop.manager, design.id, await photoBytes('#cc3355'), {
      addToReferences: 'on',
    });
    expect(added.addedToReferences).toBe(true);
    const references = await listStyleReferences(kit.shop.owner);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ style: 'ROMANTIC', caption: 'Ramo romántico de rosas' });

    // Lo staff non può dare il consenso per la fioreria: nulla viene salvato.
    const before = storage.objects.size;
    await expect(
      addBouquetPhoto(kit.shop.staff, design.id, await photoBytes('#123456'), {
        addToReferences: 'on',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(storage.objects.size).toBe(before);
    expect(await listStyleReferences(kit.shop.owner)).toHaveLength(1);
    expect((await getBouquetConfiguration(kit.shop.owner, design.id)).photo?.id).toBe(
      added.photo.id,
    );
  });

  it('eliminando il disegno se ne vanno le sue foto; la copia in "Mis ramos" resta', async () => {
    const kit = await createKit();
    const design = await saveDesign(kit);
    await addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#552211'), {});
    await addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#225511'), {
      addToReferences: 'on',
    });
    const keys = (await photoRows(design.id)).flatMap((row) => [row.storageKey, row.thumbKey]);
    expect(keys).toHaveLength(4);
    expect(keys.every((key) => storage.objects.has(key))).toBe(true);

    await deleteBouquetConfiguration(kit.shop.owner, design.id);
    expect(await photoRows(design.id)).toEqual([]);
    expect(keys.some((key) => storage.objects.has(key))).toBe(false);
    expect(await listStyleReferences(kit.shop.owner)).toHaveLength(1);
  });

  it('disegno archiviato, immagine non valida, piano Basic e altra fioreria: rifiutati', async () => {
    const kit = await createKit('Florería Foto A');
    const other = await createKit('Florería Foto B');
    const design = await saveDesign(kit);
    const added = await addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#336699'), {});

    // Un'altra fioreria riceve 404 e non cambia nulla.
    await expect(
      addBouquetPhoto(other.shop.owner, design.id, await photoBytes('#000000'), {}),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeBouquetPhoto(other.shop.owner, design.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getBouquetPhotoImage(other.shop.owner, added.photo.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await photoRows(design.id)).map((row) => row.status)).toEqual(['ACTIVE']);

    await expect(
      addBouquetPhoto(kit.shop.owner, design.id, new Uint8Array([1, 2, 3, 4]), {}),
    ).rejects.toBeInstanceOf(ValidationError);

    await setBouquetConfigurationArchived(kit.shop.owner, design.id, true);
    await expect(
      addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#999999'), {}),
    ).rejects.toMatchObject({ reason: 'builder_configuration_archived' });

    const basic = await createTestShop('Florería Foto Basic');
    await expect(
      addBouquetPhoto(basic.owner, design.id, await photoBytes('#999999'), {}),
    ).rejects.toBeInstanceOf(PlanRequiredError);
  });

  it('el pedido nacido de la cotización conserva la foto verdadera (ADR-054)', async () => {
    const kit = await createKit();
    const design = await saveDesign(kit, 'Ramo para pedido');
    await addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#336699'), {});
    const { quoteId, line } = await quoteFor(kit, design.id);
    const quoteImage = await getQuoteLineImage(kit.shop.owner, quoteId, line.id);
    await changeQuoteStatus(kit.shop.owner, quoteId, 'SENT');
    await changeQuoteStatus(kit.shop.owner, quoteId, 'ACCEPTED');

    const parts = todayInTimeZone(kit.shop.owner.timezone);
    const today = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const { id } = await createOrderFromQuote(kit.shop.owner, quoteId, {
      fulfillmentMode: 'PICKUP',
      scheduledDate: today,
    });
    const order = await getOrder(kit.shop.owner, id);
    const orderLine = order.lines[0]!;
    expect(orderLine.image?.source).toBe('photo');
    const orderImage = await getOrderLineImage(kit.shop.owner, id, orderLine.id);
    expect(Buffer.from(orderImage.bytes).equals(Buffer.from(quoteImage.bytes))).toBe(true);

    // Una foto nuova del disegno non cambia quella del pedido.
    await addBouquetPhoto(kit.shop.owner, design.id, await photoBytes('#22aa44'), {});
    const after = await getOrderLineImage(kit.shop.owner, id, orderLine.id);
    expect(Buffer.from(after.bytes).equals(Buffer.from(orderImage.bytes))).toBe(true);
  });
});
