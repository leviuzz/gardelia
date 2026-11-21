import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { PHOTO_LIMITS } from '@floral/domain';
import {
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  addCatalogItemPhoto,
  addStyleReference,
  archiveCatalogItemPhoto,
  archiveStyleReference,
  createCatalogItem,
  getCatalogItem,
  getCatalogPhotoImage,
  getStyleReferenceImage,
  listCatalogItemPhotos,
  listStyleReferences,
  setObjectStorage,
  type CatalogItemDto,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
const storage = new MemoryStorage();
let operatorEmail: string;
let shopA: TestShop;
let shopB: TestShop;
let roseA: CatalogItemDto;
let paperA: CatalogItemDto;

/** JPEG di prova con colore pieno; facoltativamente con metadati EXIF. */
async function jpeg(
  width: number,
  height: number,
  options: { exif?: boolean; orientation?: number } = {},
): Promise<Uint8Array> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 60 } },
  }).jpeg();
  if (options.exif) {
    image = image.withExif({ IFD0: { Copyright: 'Florería de prueba', Artist: 'Teléfono X' } });
  }
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return new Uint8Array(await image.toBuffer());
}

async function securityEventsFor(entityId: string) {
  return withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
}

async function withPlan(shop: TestShop, planCode: 'PLUS' | 'BASIC') {
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode,
    status: 'PILOT',
  });
}

beforeAll(async () => {
  setObjectStorage(storage);
  const operator = await createTestUser(db, { name: 'Operador Fotos' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  shopA = await createTestShop('Florería Fotos A');
  shopB = await createTestShop('Florería Fotos B');
  roseA = await createCatalogItem(shopA.owner, itemInput({ name: 'Rosa roja', colors: ['red'] }));
  paperA = await createCatalogItem(
    shopA.owner,
    itemInput({
      name: 'Papel coreano',
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      variety: null,
      colors: ['pink', 'white', 'lilac'],
    }),
  );
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('foto del catalogo', () => {
  it('salva una versione grande e una miniatura, ricodificate e senza metadati', async () => {
    const original = await jpeg(2400, 1800, { exif: true });
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const photo = await addCatalogItemPhoto(shopA.owner, roseA.id, original, { view: 'SIDE' });
    expect(photo).toMatchObject({ view: 'SIDE', color: null, width: 1600, height: 1200 });

    const full = await getCatalogPhotoImage(shopA.owner, photo.id, 'full');
    const thumb = await getCatalogPhotoImage(shopA.owner, photo.id, 'thumb');
    expect(full.contentType).toBe('image/jpeg');
    const fullMeta = await sharp(full.bytes).metadata();
    expect(fullMeta).toMatchObject({ format: 'jpeg', width: 1600, height: 1200 });
    // Niente EXIF (né GPS né dati del telefono) nei file salvati.
    expect(fullMeta.exif).toBeUndefined();
    expect((await sharp(thumb.bytes).metadata()).width).toBe(480);

    // La staff vede la foto (sola lettura) e la copertina dell'articolo.
    expect((await listCatalogItemPhotos(shopA.staff, roseA.id)).map((p) => p.id)).toContain(
      photo.id,
    );
    expect((await getCatalogItem(shopA.staff, roseA.id)).coverPhotoId).not.toBeNull();
  });

  it('raddrizza le foto ruotate dal telefono (orientamento EXIF)', async () => {
    const rotated = await jpeg(800, 400, { orientation: 6 });
    const photo = await addCatalogItemPhoto(shopA.owner, roseA.id, rotated, {});
    expect(photo).toMatchObject({ width: 400, height: 800, view: 'FRONT' });
  });

  it('carte e nastri: una foto per colore, solo fra i colori dell’articolo', async () => {
    const pink = await addCatalogItemPhoto(shopA.owner, paperA.id, await jpeg(900, 900), {
      view: 'DETAIL',
      color: 'pink',
    });
    expect(pink.color).toBe('pink');
    await expect(
      addCatalogItemPhoto(shopA.owner, paperA.id, await jpeg(900, 900), { color: 'gold' }),
    ).rejects.toMatchObject({ fieldErrors: { color: 'invalid_option' } });
    await expect(
      addCatalogItemPhoto(shopA.owner, paperA.id, await jpeg(900, 900), { color: 'red' }),
    ).rejects.toMatchObject({ fieldErrors: { color: 'invalid_option' } });
  });

  it('rifiuta file non immagine, troppo piccoli o troppo grandi', async () => {
    const reject = (bytes: Uint8Array) => addCatalogItemPhoto(shopA.owner, roseA.id, bytes, {});
    await expect(
      reject(new TextEncoder().encode('<script>alert(1)</script>')),
    ).rejects.toMatchObject({ fieldErrors: { file: 'invalid_image' } });
    await expect(reject(await jpeg(300, 200))).rejects.toMatchObject({
      fieldErrors: { file: 'image_too_small' },
    });
    const huge = new Uint8Array(PHOTO_LIMITS.maxUploadBytes + 1);
    huge.set([0xff, 0xd8, 0xff]);
    await expect(reject(huge)).rejects.toMatchObject({ fieldErrors: { file: 'file_too_large' } });
    await expect(reject(new Uint8Array())).rejects.toMatchObject({
      fieldErrors: { file: 'file_required' },
    });
    // Un JPEG troncato non passa per un'immagine valida.
    const truncated = (await jpeg(800, 800)).slice(0, 200);
    await expect(reject(truncated)).rejects.toBeInstanceOf(ValidationError);
  });

  it('i servizi non hanno foto e ogni articolo ha un limite di foto', async () => {
    const delivery = await createCatalogItem(
      shopA.owner,
      itemInput({
        name: 'Envío a domicilio',
        type: 'SERVICE',
        saleUnit: 'SERVICE',
        variety: null,
        colors: [],
        costMinor: null,
        heightCm: null,
      }),
    );
    await expect(
      addCatalogItemPhoto(shopA.owner, delivery.id, await jpeg(800, 800), {}),
    ).rejects.toMatchObject({ fieldErrors: { file: 'photos_not_allowed_for_type' } });

    const tulip = await createCatalogItem(shopA.owner, itemInput({ name: 'Tulipán' }));
    const small = await jpeg(400, 400);
    for (let i = 0; i < PHOTO_LIMITS.perItem; i++) {
      await addCatalogItemPhoto(shopA.manager, tulip.id, small, {});
    }
    await expect(addCatalogItemPhoto(shopA.manager, tulip.id, small, {})).rejects.toMatchObject({
      fieldErrors: { file: 'too_many_photos' },
    });
  });

  it('togliere una foto la nasconde e la copertina passa alla successiva', async () => {
    const lily = await createCatalogItem(shopA.owner, itemInput({ name: 'Lilium' }));
    const first = await addCatalogItemPhoto(shopA.owner, lily.id, await jpeg(600, 600), {});
    const second = await addCatalogItemPhoto(shopA.owner, lily.id, await jpeg(600, 600), {});
    expect((await getCatalogItem(shopA.owner, lily.id)).coverPhotoId).toBe(first.id);

    await expect(archiveCatalogItemPhoto(shopA.staff, first.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await archiveCatalogItemPhoto(shopA.owner, first.id)).toEqual({
      catalogItemId: lily.id,
    });
    expect((await listCatalogItemPhotos(shopA.owner, lily.id)).map((p) => p.id)).toEqual([
      second.id,
    ]);
    expect((await getCatalogItem(shopA.owner, lily.id)).coverPhotoId).toBe(second.id);
    await expect(getCatalogPhotoImage(shopA.owner, first.id, 'thumb')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lo staff non carica foto', async () => {
    await expect(
      addCatalogItemPhoto(shopA.staff, roseA.id, await jpeg(600, 600), {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('isolamento A ↔ B: nessuna foto né articolo di un’altra fioreria', async () => {
    const photo = await addCatalogItemPhoto(shopA.owner, roseA.id, await jpeg(600, 600), {});
    await expect(getCatalogPhotoImage(shopB.owner, photo.id, 'full')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(archiveCatalogItemPhoto(shopB.owner, photo.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listCatalogItemPhotos(shopB.owner, roseA.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      addCatalogItemPhoto(shopB.owner, roseA.id, await jpeg(600, 600), {}),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Il tentativo è registrato come evento di sicurezza della piattaforma.
    const events = await securityEventsFor(photo.id);
    expect(events.some((e) => e.action === 'security.cross_tenant_access_attempt')).toBe(true);
    // La foto di A resta intatta.
    expect(
      (await getCatalogPhotoImage(shopA.owner, photo.id, 'full')).bytes.length,
    ).toBeGreaterThan(0);
  });
});

describe('Mis ramos (riferimenti di stile)', () => {
  it('solo con il piano Plus', async () => {
    await withPlan(shopB, 'BASIC');
    await expect(listStyleReferences(shopB.owner)).rejects.toBeInstanceOf(PlanRequiredError);
    await expect(
      addStyleReference(shopB.owner, await jpeg(800, 800), { consent: 'on' }),
    ).rejects.toBeInstanceOf(PlanRequiredError);
  });

  it('senza consenso non si salva nulla; con consenso si registra chi e quando', async () => {
    await withPlan(shopA, 'PLUS');
    const before = storage.objects.size;
    await expect(
      addStyleReference(shopA.owner, await jpeg(1200, 900), { style: 'GARDEN' }),
    ).rejects.toMatchObject({ fieldErrors: { consent: 'consent_required' } });
    expect(storage.objects.size).toBe(before);

    const reference = await addStyleReference(
      shopA.manager,
      await jpeg(1200, 900, { exif: true }),
      {
        consent: 'on',
        style: 'GARDEN',
        caption: 'Ramo de boda en Calvillo',
      },
    );
    expect(reference).toMatchObject({ style: 'GARDEN', caption: 'Ramo de boda en Calvillo' });
    expect(reference.consentAt).toBeInstanceOf(Date);
    const stored = await withSystemContext(db, { reason: 'test: consenso' }, (tx) =>
      tx.styleReferencePhoto.findUniqueOrThrow({ where: { id: reference.id } }),
    );
    expect(stored.consentById).toBe(shopA.manager.userId);
    const image = await getStyleReferenceImage(shopA.staff, reference.id, 'full');
    expect((await sharp(image.bytes).metadata()).exif).toBeUndefined();
    expect((await listStyleReferences(shopA.staff)).map((r) => r.id)).toContain(reference.id);
  });

  it('lo staff le vede ma non le carica né le toglie', async () => {
    await withPlan(shopA, 'PLUS');
    const reference = await addStyleReference(shopA.owner, await jpeg(900, 900), { consent: 'on' });
    await expect(
      addStyleReference(shopA.staff, await jpeg(900, 900), { consent: 'on' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveStyleReference(shopA.staff, reference.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await archiveStyleReference(shopA.owner, reference.id);
    expect((await listStyleReferences(shopA.owner)).map((r) => r.id)).not.toContain(reference.id);
    await expect(getStyleReferenceImage(shopA.owner, reference.id, 'thumb')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('isolamento A ↔ B: le foto di stile non passano mai fra fiorerie', async () => {
    await withPlan(shopA, 'PLUS');
    await withPlan(shopB, 'PLUS');
    const reference = await addStyleReference(shopA.owner, await jpeg(900, 900), { consent: 'on' });
    expect((await listStyleReferences(shopB.owner)).map((r) => r.id)).not.toContain(reference.id);
    await expect(getStyleReferenceImage(shopB.owner, reference.id, 'full')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(archiveStyleReference(shopB.owner, reference.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listStyleReferences(shopA.owner)).map((r) => r.id)).toContain(reference.id);
  });
});
