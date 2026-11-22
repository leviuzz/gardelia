import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addCustomerAddress,
  addCustomerOccasion,
  archiveCustomerAddress,
  createCustomer,
  getCustomer,
  listCustomers,
  listUpcomingOccasions,
  removeCustomerOccasion,
  setCustomerArchived,
  updateCustomer,
  updateCustomerAddress,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

const db = getDb();

function customerInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'PERSON',
    displayName: 'María Fernanda López',
    legalName: null,
    taxId: null,
    email: 'mafer@example.test',
    phone: '+524495550142',
    notes: null,
    preferences: 'Tonos pastel',
    restrictions: null,
    tags: ['frecuente'],
    acquisitionChannel: 'instagram',
    marketingConsent: false,
    ...overrides,
  };
}

const address = {
  label: 'Casa',
  recipientName: null,
  recipientPhone: null,
  addressLine1: 'Calle Juárez 10',
  addressLine2: null,
  neighborhood: 'Centro',
  city: 'Aguascalientes',
  region: 'AGU',
  postalCode: '20000',
  deliveryNotes: 'Portón verde',
  isDefault: false,
};

let shopA: TestShop;
let shopB: TestShop;

beforeAll(async () => {
  shopA = await createTestShop('Florería A');
  shopB = await createTestShop('Florería B');
});

afterAll(async () => {
  await disconnectDb();
});

describe('clienti', () => {
  it('crea un cliente diretto anche se l’input prova a dichiarare un’origine di piattaforma', async () => {
    const { id } = await createCustomer(shopA.manager, {
      ...customerInput(),
      acquisitionSource: 'NETWORK_B2B',
    });
    const customer = await getCustomer(shopA.owner, id);
    expect(customer.acquisitionSource).toBe('MERCHANT_DIRECT');
    expect(customer.acquisitionChannel).toBe('instagram');
  });

  it('registra la data del consenso marketing e la azzera alla revoca', async () => {
    const { id } = await createCustomer(shopA.owner, customerInput({ marketingConsent: true }));
    const withConsent = await getCustomer(shopA.owner, id);
    expect(withConsent.marketingConsentAt).toBeInstanceOf(Date);
    await updateCustomer(shopA.owner, id, customerInput({ marketingConsent: false }));
    expect((await getCustomer(shopA.owner, id)).marketingConsentAt).toBeNull();
  });

  it('l’audit registra i nomi dei campi cambiati, non i dati personali', async () => {
    const { id } = await createCustomer(shopA.owner, customerInput());
    await updateCustomer(shopA.owner, id, customerInput({ phone: '+524495559999' }));
    const entries = await withTenantContext(db, shopA.owner, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: shopA.owner.tenantId, entityId: id } }),
    );
    const update = entries.find((entry) => entry.action === 'customer.updated');
    expect(update?.metadata).toEqual({ changedFields: ['phone'] });
    expect(JSON.stringify(entries)).not.toContain('5559999');
    expect(JSON.stringify(entries)).not.toContain('María');
  });

  it('cerca per nome, email, etichetta o cifre del telefono', async () => {
    const local = await createTestShop();
    await createCustomer(
      local.owner,
      customerInput({
        displayName: 'Hotel Casa Fuentes',
        type: 'COMPANY',
        phone: '+524495550177',
        tags: ['empresa'],
      }),
    );
    await createCustomer(
      local.owner,
      customerInput({ displayName: 'Ana Ruiz', email: 'ana@ejemplo.test', phone: null, tags: [] }),
    );
    expect(
      (await listCustomers(local.owner, { q: 'casa' })).items.map((c) => c.displayName),
    ).toEqual(['Hotel Casa Fuentes']);
    expect((await listCustomers(local.owner, { q: '449 555 0177' })).total).toBe(1);
    expect((await listCustomers(local.owner, { q: 'EMPRESA' })).total).toBe(1);
    expect((await listCustomers(local.owner, { type: 'COMPANY' })).total).toBe(1);
  });

  it('archivia e ripristina', async () => {
    const { id } = await createCustomer(
      shopA.owner,
      customerInput({ displayName: 'Cliente archivable' }),
    );
    await setCustomerArchived(shopA.owner, id, true);
    expect(
      (await listCustomers(shopA.owner, { status: 'ARCHIVED' })).items.map((c) => c.id),
    ).toContain(id);
    await setCustomerArchived(shopA.owner, id, false);
    expect((await getCustomer(shopA.owner, id)).status).toBe('ACTIVE');
  });
});

describe('indirizzi e ricorrenze', () => {
  it('il primo indirizzo è predefinito; un nuovo predefinito sostituisce il precedente', async () => {
    const { id } = await createCustomer(shopA.owner, customerInput());
    const first = await addCustomerAddress(shopA.owner, id, address);
    const second = await addCustomerAddress(shopA.owner, id, {
      ...address,
      label: 'Oficina',
      isDefault: true,
    });
    let customer = await getCustomer(shopA.owner, id);
    expect(customer.addresses.map((a) => [a.id, a.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);

    await archiveCustomerAddress(shopA.owner, id, second.id);
    customer = await getCustomer(shopA.owner, id);
    expect(customer.addresses).toHaveLength(1);
    expect(customer.addresses[0]).toMatchObject({ id: first.id, isDefault: true });

    await updateCustomerAddress(shopA.owner, id, first.id, {
      ...address,
      deliveryNotes: 'Tocar el timbre',
    });
    expect((await getCustomer(shopA.owner, id)).addresses[0]?.deliveryNotes).toBe(
      'Tocar el timbre',
    );
  });

  it('valida gli indirizzi lato server', async () => {
    const { id } = await createCustomer(shopA.owner, customerInput());
    await expect(
      addCustomerAddress(shopA.owner, id, { ...address, postalCode: '123' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('il nuovo cliente nasce con le sue date speciali, tutto o niente', async () => {
    const local = await createTestShop();
    const { id } = await createCustomer(local.owner, {
      ...customerInput(),
      occasions: [
        { type: 'BIRTHDAY', month: 5, day: 10, year: 1990 },
        { type: 'ANNIVERSARY', month: 2, day: 14, personName: null, remindDaysBefore: 10 },
      ],
    });
    const detail = await getCustomer(local.owner, id);
    expect(
      detail.occasions.map((occasion) => [occasion.type, occasion.month, occasion.day]),
    ).toEqual(
      expect.arrayContaining([
        ['BIRTHDAY', 5, 10],
        ['ANNIVERSARY', 2, 14],
      ]),
    );
    expect(detail.occasions.find((occasion) => occasion.type === 'ANNIVERSARY')).toMatchObject({
      remindDaysBefore: 10,
    });

    // Una data sbagliata: nessun cliente creato.
    const before = (await listCustomers(local.owner, {})).total;
    await expect(
      createCustomer(local.owner, {
        ...customerInput({ displayName: 'Cliente con fecha mala' }),
        occasions: [{ type: 'CUSTOM', month: 2, day: 30 }],
      }),
    ).rejects.toMatchObject({
      fieldErrors: { 'occasions.0.day': 'invalid_date', 'occasions.0.label': 'required' },
    });
    expect((await listCustomers(local.owner, {})).total).toBe(before);
  });

  it('elenca le ricorrenze imminenti dei clienti attivi', async () => {
    const local = await createTestShop();
    const { id } = await createCustomer(local.owner, customerInput());
    const today = new Date();
    const inTwoDays = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: local.owner.timezone,
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(inTwoDays);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const occasion = await addCustomerOccasion(local.owner, id, {
      type: 'BIRTHDAY',
      personName: 'Su mamá',
      month: String(month),
      day: String(day),
      remindDaysBefore: '3',
    });

    const upcoming = await listUpcomingOccasions(local.owner);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({
      customerId: id,
      daysUntil: 2,
      inReminderWindow: true,
      personName: 'Su mamá',
    });

    await removeCustomerOccasion(local.owner, id, occasion.id);
    expect(await listUpcomingOccasions(local.owner)).toHaveLength(0);
  });
});

describe('permessi e isolamento A ↔ B', () => {
  it('lo staff legge i clienti ma non li modifica né vede i dati fiscali', async () => {
    const { id } = await createCustomer(
      shopA.owner,
      customerInput({ type: 'COMPANY', legalName: 'Hotel SA', taxId: 'HCF190312AB1' }),
    );
    const asStaff = await getCustomer(shopA.staff, id);
    expect(asStaff.legalName).toBeNull();
    expect(asStaff.taxId).toBeNull();
    expect(asStaff.canWrite).toBe(false);
    expect((await getCustomer(shopA.owner, id)).taxId).toBe('HCF190312AB1');
    await expect(createCustomer(shopA.staff, customerInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateCustomer(shopA.staff, id, customerInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(addCustomerAddress(shopA.staff, id, address)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('A non vede, non modifica e non arricchisce i clienti di B (404 + evento di sicurezza)', async () => {
    const { id: customerB } = await createCustomer(
      shopB.owner,
      customerInput({ displayName: 'Cliente secreto de B' }),
    );
    const addressB = await addCustomerAddress(shopB.owner, customerB, address);
    const occasionB = await addCustomerOccasion(shopB.owner, customerB, {
      type: 'ANNIVERSARY',
      month: '6',
      day: '1',
    });

    expect((await listCustomers(shopA.owner, { q: 'secreto' })).total).toBe(0);
    await expect(getCustomer(shopA.owner, customerB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateCustomer(shopA.owner, customerB, customerInput({ displayName: 'Hackeado' })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCustomerArchived(shopA.owner, customerB, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addCustomerAddress(shopA.owner, customerB, address)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateCustomerAddress(shopA.owner, customerB, addressB.id, address),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      archiveCustomerAddress(shopA.owner, customerB, addressB.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addCustomerOccasion(shopA.owner, customerB, { type: 'BIRTHDAY', month: '1', day: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      removeCustomerOccasion(shopA.owner, customerB, occasionB.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    const customer = await getCustomer(shopB.owner, customerB);
    expect(customer.displayName).toBe('Cliente secreto de B');
    expect(customer.addresses).toHaveLength(1);
    expect(customer.occasions).toHaveLength(1);

    const events = await withSystemContext(db, { reason: 'test: read security events' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: customerB,
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('le ricorrenze imminenti di B non compaiono ad A', async () => {
    const upcomingA = await listUpcomingOccasions(shopA.owner, { withinDays: 366 });
    expect(upcomingA.every((occasion) => occasion.customerName !== 'Cliente secreto de B')).toBe(
      true,
    );
  });
});
