import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { STOREFRONT_SERVICE_LIMITS } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  addStorefrontServicePhoto,
  archiveCareSlot,
  archiveStorefrontService,
  createCatalogItem,
  createCareSlot,
  createStorefrontService,
  getPublicStoreService,
  getPublicStoreServicePhoto,
  getPublicStorefront,
  getStorePreview,
  getStorefrontServicePhotoImage,
  getStorefrontServicesSettings,
  moveStorefrontService,
  removeStorefrontServicePhoto,
  restoreCareSlot,
  saveStorefrontService,
  setObjectStorage,
  setOnlineStorePublished,
  setStorefrontServicePublished,
  updateCareSettings,
  updateOnlineStore,
  updateTenantProfile,
  type TenantContext,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Marketplace M5 (ADR-089): i servizi in vetrina dal lato della fioreria (Impostazioni → Negozio
 * online → «Servizi in vetrina») e dal lato di chi guarda la vetrina: i quattro predefiniti, i
 * servizi della fioreria con il limite, Floral Care solo con l'offerta pronta, le foto (fino a 6),
 * l'ordine, l'archivio, i permessi, il registro senza testi e l'isolamento fra fiorerie.
 */

const db = getDb();
const storage = new MemoryStorage();

let shop: TestShop;
let other: TestShop;

async function jpeg(color = '#7a3b5c'): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

async function openShop(target: TestShop, name: string): Promise<void> {
  await updateTenantProfile(target.owner, {
    displayName: name,
    contactEmail: `contacto-${target.tenant.slug}@example.com`,
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
  await updateOnlineStore(target.owner, {
    description: '',
    paymentMethods: ['TRANSFER'],
    paymentInstructions: '',
  });
  // Per pubblicare il negozio serve almeno un prodotto online (M1).
  await createCatalogItem(
    target.owner,
    itemInput({ type: 'BOUQUET', saleUnit: 'PIECE', name: 'Ramo de la vetrina', isOnline: true }),
  );
  await setOnlineStorePublished(target.owner, true);
}

/** L'offerta di Floral Care pronta: tariffe con le frequenze e una fascia attiva. */
async function careOffer(ctx: TenantContext): Promise<string> {
  await updateCareSettings(ctx, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
  const slot = await createCareSlot(ctx, {
    weekday: '2',
    start: '09:00',
    end: '11:00',
    capacity: '2',
  });
  return slot.id;
}

async function auditOf(entityId: string) {
  return withSystemContext(db, { reason: 'test: registro dei servizi' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );
}

async function crossTenantEvents(entityId: string) {
  const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
  return events.filter((event) => event.action === 'security.cross_tenant_access_attempt');
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Servicios');
  other = await createTestShop('Florería Servicios Ajena');
  await openShop(shop, 'Florería Servicios');
  await openShop(other, 'Florería Servicios Ajena');
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('Impostazioni → «Servizi in vetrina»', () => {
  it('i quattro predefiniti ci sono sempre, spenti, anche senza righe', async () => {
    const fresh = await createTestShop('Florería Servicios Nueva');
    const settings = await getStorefrontServicesSettings(fresh.owner);
    expect(
      settings.presets.map((service) => [service.kind, service.id, service.isPublished]),
    ).toEqual([
      ['EVENT', null, false],
      ['VENUE', null, false],
      ['WEEKLY', null, false],
      ['CARE', null, false],
    ]);
    expect(settings.custom).toEqual([]);
    expect(settings.careReady).toBe(false);
    expect(settings.canEdit).toBe(true);
    // Lo staff legge ma non cambia.
    const staffView = await getStorefrontServicesSettings(fresh.staff);
    expect(staffView.canEdit).toBe(false);
    await expect(
      saveStorefrontService(fresh.staff, { kind: 'EVENT' }, { description: 'Bodas' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setStorefrontServicePublished(fresh.staff, { kind: 'EVENT' }, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('un predefinito si salva e si pubblica; il registro non ha i testi', async () => {
    const saved = await saveStorefrontService(
      shop.manager,
      { kind: 'EVENT' },
      { description: 'Bodas, XV años y bautizos.', includes: 'Ramo de novia', priceFrom: '8500' },
    );
    // Salvare di nuovo lo stesso predefinito non crea una seconda riga.
    const again = await saveStorefrontService(
      shop.owner,
      { kind: 'EVENT' },
      { description: 'Bodas, XV años y bautizos en todo Aguascalientes.', priceFrom: '8500' },
    );
    expect(again.id).toBe(saved.id);
    await setStorefrontServicePublished(shop.owner, { kind: 'EVENT' }, true);
    const settings = await getStorefrontServicesSettings(shop.owner);
    const event = settings.presets.find((service) => service.kind === 'EVENT');
    expect(event).toMatchObject({
      id: saved.id,
      isPublished: true,
      priceFromMinor: 850000,
      includes: null,
      description: 'Bodas, XV años y bautizos en todo Aguascalientes.',
    });
    const audit = await auditOf(saved.id);
    expect(audit.map((row) => row.action)).toEqual([
      'storefront_service.saved',
      'storefront_service.saved',
      'storefront_service.published',
    ]);
    expect(JSON.stringify(audit.map((row) => row.metadata))).not.toContain('Bodas');
  });

  it('Floral Care si accende solo con l’offerta pronta', async () => {
    const error = await setStorefrontServicePublished(shop.owner, { kind: 'CARE' }, true).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).reason).toBe('service_care_not_ready');
    const slotId = await careOffer(shop.owner);
    expect((await getStorefrontServicesSettings(shop.owner)).careReady).toBe(true);
    await setStorefrontServicePublished(shop.owner, { kind: 'CARE' }, true);

    // In vetrina; senza fasce attive sparisce da solo (resta acceso nelle Impostazioni).
    const visible = await getPublicStorefront(shop.tenant.slug, {});
    expect(visible?.services.map((service) => service.kind)).toEqual(['EVENT', 'CARE']);
    await archiveCareSlot(shop.owner, slotId, {});
    const hidden = await getPublicStorefront(shop.tenant.slug, {});
    expect(hidden?.services.map((service) => service.kind)).toEqual(['EVENT']);
    const care = (await getStorefrontServicesSettings(shop.owner)).presets.find(
      (service) => service.kind === 'CARE',
    );
    expect(care?.isPublished).toBe(true);
    expect(await getPublicStoreService(shop.tenant.slug, care?.id)).toBeNull();
    await restoreCareSlot(shop.owner, slotId);
  });

  it('i servizi della fioreria: nome obbligatorio, ordine con le frecce, archivio', async () => {
    await expect(
      createStorefrontService(shop.owner, { name: '', description: 'Sin nombre' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const funeral = await createStorefrontService(shop.owner, {
      name: 'Coronas fúnebres',
      description: 'Coronas y cruces.',
      askDate: 'on',
      askAddress: 'on',
    });
    const church = await createStorefrontService(shop.owner, {
      name: 'Arreglos para iglesia',
      priceFrom: '2500',
    });
    await setStorefrontServicePublished(shop.owner, { serviceId: funeral.id }, true);
    await setStorefrontServicePublished(shop.owner, { serviceId: church.id }, true);

    const names = async () =>
      (await getPublicStorefront(shop.tenant.slug, {}))?.services.map(
        (service) => service.name ?? service.kind,
      );
    // I predefiniti prima, poi quelli della fioreria nell'ordine di creazione.
    expect(await names()).toEqual(['EVENT', 'CARE', 'Coronas fúnebres', 'Arreglos para iglesia']);
    await moveStorefrontService(shop.owner, church.id, 'up');
    expect(await names()).toEqual(['EVENT', 'CARE', 'Arreglos para iglesia', 'Coronas fúnebres']);
    // Al bordo non si sposta più; un predefinito non si sposta.
    await moveStorefrontService(shop.owner, church.id, 'up');
    expect(await names()).toEqual(['EVENT', 'CARE', 'Arreglos para iglesia', 'Coronas fúnebres']);

    const presetId = (await getStorefrontServicesSettings(shop.owner)).presets[0]!.id!;
    const archivePreset = await archiveStorefrontService(shop.owner, presetId).catch(
      (caught: unknown) => caught,
    );
    expect((archivePreset as ConflictError).reason).toBe('storefront_service_preset');

    await archiveStorefrontService(shop.owner, church.id);
    expect(await names()).toEqual(['EVENT', 'CARE', 'Coronas fúnebres']);
    const settings = await getStorefrontServicesSettings(shop.owner);
    expect(settings.custom.map((service) => service.name)).toEqual(['Coronas fúnebres']);
    expect(settings.custom[0]).toMatchObject({ askDate: true, askAddress: true });
    // Un servizio archiviato non si cambia più.
    await expect(
      saveStorefrontService(shop.owner, { serviceId: church.id }, { name: 'Otra vez' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it(`al massimo ${STOREFRONT_SERVICE_LIMITS.customPerShop} servizi della fioreria`, async () => {
    const busy = await createTestShop('Florería Muchos Servicios');
    for (let index = 0; index < STOREFRONT_SERVICE_LIMITS.customPerShop; index += 1) {
      await createStorefrontService(busy.owner, { name: `Servicio ${index + 1}` });
    }
    const error = await createStorefrontService(busy.owner, { name: 'Uno más' }).catch(
      (caught: unknown) => caught,
    );
    expect((error as ConflictError).reason).toBe('storefront_services_limit');
  });

  it('le foto: fino a 6, private nelle Impostazioni, pubbliche solo con il servizio in vetrina', async () => {
    const added = await addStorefrontServicePhoto(shop.owner, { kind: 'VENUE' }, await jpeg());
    const venueId = added.serviceId;
    expect(
      storage.objects.has(
        `tenants/${shop.owner.tenantId}/storefront-services/${added.photoId}.jpg`,
      ),
    ).toBe(true);
    // Il servizio è spento: la foto non è pubblica, ma la fioreria la vede.
    expect(
      await getPublicStoreServicePhoto(shop.tenant.slug, venueId, added.photoId, 'thumb'),
    ).toBeNull();
    const privateImage = await getStorefrontServicePhotoImage(shop.staff, added.photoId, 'thumb');
    expect(privateImage.bytes.byteLength).toBeGreaterThan(0);

    for (let index = 1; index < STOREFRONT_SERVICE_LIMITS.photos; index += 1) {
      await addStorefrontServicePhoto(shop.owner, { serviceId: venueId }, await jpeg());
    }
    const tooMany = await addStorefrontServicePhoto(
      shop.owner,
      { serviceId: venueId },
      await jpeg(),
    ).catch((caught: unknown) => caught);
    expect((tooMany as ValidationError).fieldErrors).toEqual({ file: 'too_many_photos' });

    await setStorefrontServicePublished(shop.owner, { kind: 'VENUE' }, true);
    const page = await getPublicStoreService(shop.tenant.slug, venueId);
    expect(page?.service.photoIds).toHaveLength(STOREFRONT_SERVICE_LIMITS.photos);
    expect(page?.service.photoId).toBe(added.photoId);
    expect(
      await getPublicStoreServicePhoto(shop.tenant.slug, venueId, added.photoId, 'full'),
    ).not.toBeNull();

    // Tolta: sparisce dalla vetrina e dalle Impostazioni.
    await removeStorefrontServicePhoto(shop.manager, added.photoId);
    expect(
      await getPublicStoreServicePhoto(shop.tenant.slug, venueId, added.photoId, 'full'),
    ).toBeNull();
    await expect(
      getStorefrontServicePhotoImage(shop.owner, added.photoId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    const audit = await auditOf(venueId);
    expect(audit.map((row) => row.action)).toContain('storefront_service.photo_removed');
  });

  it('l’anteprima della fioreria ha la stessa sezione «Servicios»', async () => {
    const preview = await getStorePreview(shop.owner, {});
    const store = await getPublicStorefront(shop.tenant.slug, {});
    expect(preview.services).toEqual(store?.services);
  });
});

describe('isolamento fra fiorerie', () => {
  it('un servizio o una foto di un’altra fioreria è un 404 con l’evento di sicurezza', async () => {
    const foreign = await createStorefrontService(other.owner, { name: 'Servicio ajeno' });
    await setStorefrontServicePublished(other.owner, { serviceId: foreign.id }, true);
    const photo = await addStorefrontServicePhoto(
      other.owner,
      { serviceId: foreign.id },
      await jpeg('#1d6b4a'),
    );

    await expect(
      saveStorefrontService(shop.owner, { serviceId: foreign.id }, { name: 'Mío' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setStorefrontServicePublished(shop.owner, { serviceId: foreign.id }, false),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveStorefrontService(shop.owner, foreign.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(moveStorefrontService(shop.owner, foreign.id, 'up')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      addStorefrontServicePhoto(shop.owner, { serviceId: foreign.id }, await jpeg()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeStorefrontServicePhoto(shop.owner, photo.photoId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getStorefrontServicePhotoImage(shop.owner, photo.photoId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await crossTenantEvents(foreign.id)).length).toBeGreaterThanOrEqual(4);
    expect((await crossTenantEvents(photo.photoId)).length).toBeGreaterThanOrEqual(2);

    // Dalla vetrina di una fioreria non si apre il servizio dell'altra.
    expect(await getPublicStoreService(shop.tenant.slug, foreign.id)).toBeNull();
    expect(
      await getPublicStoreServicePhoto(shop.tenant.slug, foreign.id, photo.photoId, 'full'),
    ).toBeNull();
    expect(await getPublicStoreService(other.tenant.slug, foreign.id)).not.toBeNull();
    // Il servizio dell'altra non è cambiato.
    const theirs = await getStorefrontServicesSettings(other.owner);
    expect(theirs.custom[0]).toMatchObject({ name: 'Servicio ajeno', isPublished: true });
  });

  it('una vetrina ritirata non mostra più i servizi', async () => {
    const closing = await createTestShop('Florería Servicios Cerrada');
    await openShop(closing, 'Florería Servicios Cerrada');
    const saved = await saveStorefrontService(closing.owner, { kind: 'WEEKLY' }, {});
    await setStorefrontServicePublished(closing.owner, { kind: 'WEEKLY' }, true);
    expect(await getPublicStoreService(closing.tenant.slug, saved.id)).not.toBeNull();
    await setOnlineStorePublished(closing.owner, false);
    expect(await getPublicStoreService(closing.tenant.slug, saved.id)).toBeNull();
  });
});
