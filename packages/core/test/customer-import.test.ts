/**
 * Import di clienti da CSV (CRM-01, ADR-070 blocco 3): bozza con anteprima, colonne scelte a mano,
 * duplicati saltati, clienti importati senza consenso marketing e con le loro date; solo
 * proprietario e manager; la bozza di un'altra fioreria risponde 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  cancelCustomerImport,
  confirmCustomerImport,
  createCustomer,
  createCustomerImport,
  findOpenCustomerImport,
  getCustomer,
  getCustomerImport,
  closeStaleCustomerImports,
  listCustomers,
  updateCustomerImportMapping,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

const db = getDb();
let shop: TestShop;
let other: TestShop;

function person(name: string, contact: { phone?: string; email?: string }) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

const FILE = [
  'Nombre;Teléfono;Correo;Cumpleaños;Etiquetas;Columna rara',
  'Importada Ana;449 555 0301;ana.importada@example.com;14/02/1990;vip, bodas;x',
  'Importado Beto;449 555 0302;;31/04;;x',
  'Importada Carla;449 555 0303;;;;x',
  'Importada Carla otra vez;+52 449 555 0303;;;;x',
  ';;;;;',
  'Importado Darío;;DARIO.EXISTE@example.com;;;x',
  'Importada Elena;;elena.importada@example.com;2000-06-20;;x',
].join('\r\n');

beforeAll(async () => {
  shop = await createTestShop('Florería Importa');
  other = await createTestShop('Florería Importa Ajena');
  await createCustomer(
    shop.owner,
    person('Darío de siempre', { email: 'dario.existe@example.com' }),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('import di clienti da CSV', () => {
  it('anteprima, import dei soli validi e non duplicati, senza consenso', async () => {
    const manager = shop.manager;
    const { id } = await createCustomerImport(manager, { fileName: 'clientes.csv', content: FILE });
    expect(await findOpenCustomerImport(manager)).toMatchObject({ id, fileName: 'clientes.csv' });

    const preview = await getCustomerImport(manager, id);
    expect(preview).toMatchObject({ status: 'DRAFT', rowCount: 6, mappingErrors: null });
    expect(preview.columns.map((column) => column.field)).toEqual([
      'displayName',
      'phone',
      'email',
      'birthday',
      'tags',
      null,
    ]);
    expect(preview.columns[1]).toMatchObject({ header: 'Teléfono', sample: '449 555 0301' });
    // Beto ha una data impossibile; la seconda Carla ripete il telefono; Darío esiste già.
    expect(preview.summary).toEqual({ ready: 3, invalid: 1, duplicates: 2 });
    expect(preview.problems).toEqual([
      {
        line: 3,
        displayName: 'Importado Beto',
        errors: { birthday: 'invalid_date' },
        duplicate: null,
      },
      {
        line: 5,
        displayName: 'Importada Carla otra vez',
        errors: null,
        duplicate: { reason: 'file', firstLine: 4 },
      },
      {
        line: 7,
        displayName: 'Importado Darío',
        errors: null,
        duplicate: {
          reason: 'existing',
          customerId: expect.any(String),
          customerName: 'Darío de siempre',
        },
      },
    ]);
    expect(preview.samples[0]).toEqual({
      line: 2,
      displayName: 'Importada Ana',
      phone: '+524495550301',
      email: 'ana.importada@example.com',
      tags: ['vip', 'bodas'],
      occasions: 1,
    });

    await expect(confirmCustomerImport(manager, id)).resolves.toEqual({ imported: 3, skipped: 3 });
    const done = await getCustomerImport(manager, id);
    expect(done).toMatchObject({ status: 'DONE', importedCount: 3, skippedCount: 3, columns: [] });
    expect(await findOpenCustomerImport(manager)).toBeNull();

    const listed = await listCustomers(manager, { q: 'Importad' });
    expect(listed.items.map((item) => item.displayName)).toEqual([
      'Importada Ana',
      'Importada Carla',
      'Importada Elena',
    ]);
    const ana = await getCustomer(manager, listed.items[0]?.id ?? '');
    expect(ana).toMatchObject({
      acquisitionSource: 'IMPORT',
      marketingConsent: false,
      marketingConsentAt: null,
      tags: ['vip', 'bodas'],
      occasions: [{ type: 'BIRTHDAY', month: 2, day: 14, year: 1990 }],
    });

    // Il testo del file non resta; nel registro solo i conti.
    const stored = await withSystemContext(db, { reason: 'test: import concluso' }, (tx) =>
      Promise.all([
        tx.customerImport.findUniqueOrThrow({ where: { id }, select: { content: true } }),
        tx.auditLog.findMany({
          where: { tenantId: shop.tenant.tenantId, action: 'customer.imported' },
          select: { entityId: true, metadata: true },
        }),
      ]),
    );
    expect(stored[0].content).toBe('');
    expect(stored[1]).toEqual([{ entityId: id, metadata: { count: 3, skipped: 3, occasions: 2 } }]);

    // Un secondo clic non importa di nuovo.
    await expect(confirmCustomerImport(manager, id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('colonne scelte a mano: il nome è obbligatorio, un dato da una sola colonna', async () => {
    const owner = shop.owner;
    const { id } = await createCustomerImport(owner, {
      fileName: 'lista.csv',
      content: 'Cliente,Cel,Otro\nMano Uno,4495550311,a\nMano Dos,4495550312,b\n',
    });
    // "Cel" non è un nome conosciuto: si sceglie a mano.
    const first = await getCustomerImport(owner, id);
    expect(first.columns.map((column) => column.field)).toEqual(['displayName', null, null]);
    expect(first.summary).toEqual({ ready: 2, invalid: 0, duplicates: 0 });

    await expect(
      updateCustomerImportMapping(owner, id, { column: { '0': '', '1': 'phone', '2': '' } }),
    ).rejects.toMatchObject({ fieldErrors: { _form: 'customers_import_name_column' } });
    await expect(
      updateCustomerImportMapping(owner, id, {
        column: { '0': 'displayName', '1': 'phone', '2': 'phone' },
      }),
    ).rejects.toMatchObject({ fieldErrors: { 'column.2': 'customers_import_repeated_column' } });

    await updateCustomerImportMapping(owner, id, {
      column: { '0': 'displayName', '1': 'phone', '2': '' },
    });
    const second = await getCustomerImport(owner, id);
    expect(second.samples.map((sample) => sample.phone)).toEqual([
      '+524495550311',
      '+524495550312',
    ]);

    await cancelCustomerImport(owner, id);
    await expect(getCustomerImport(owner, id)).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(confirmCustomerImport(owner, id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('file vuoti, troppo grandi o senza nulla di nuovo; lo staff non importa', async () => {
    const owner = shop.owner;
    await expect(
      createCustomerImport(owner, { fileName: 'vacio.csv', content: 'Nombre\n' }),
    ).rejects.toMatchObject({ fieldErrors: { file: 'customers_import_empty' } });
    await expect(
      createCustomerImport(owner, {
        fileName: 'enorme.csv',
        content: `Nombre\n${'Ana\n'.repeat(1001)}`,
      }),
    ).rejects.toMatchObject({ fieldErrors: { file: 'customers_import_too_many_rows' } });
    await expect(
      createCustomerImport(owner, { fileName: 'pesado.csv', content: 'x'.repeat(600_000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCustomerImport(shop.staff, { fileName: 'a.csv', content: 'Nombre\nAna\n' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Tutte le righe esistono già: niente da importare.
    const { id } = await createCustomerImport(owner, {
      fileName: 'repetido.csv',
      content: 'Nombre,Email\nDarío otra vez,dario.existe@example.com\n',
    });
    await expect(confirmCustomerImport(owner, id)).rejects.toMatchObject({
      reason: 'customers_import_nothing',
    });
  });

  it('la bozza di un’altra fioreria: 404, nessun import, evento di sicurezza', async () => {
    const { id } = await createCustomerImport(shop.owner, {
      fileName: 'privado.csv',
      content: 'Nombre,Teléfono\nCliente Privada,4495550399\n',
    });
    await expect(getCustomerImport(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmCustomerImport(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateCustomerImportMapping(other.owner, id, { column: { '0': 'displayName' } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelCustomerImport(other.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await findOpenCustomerImport(other.owner)).toBeNull();
    // Nessun cliente creato in nessuna delle due fiorerie; la bozza resta aperta per la sua.
    expect((await listCustomers(other.owner, { q: 'Cliente Privada' })).total).toBe(0);
    expect((await listCustomers(shop.owner, { q: 'Cliente Privada' })).total).toBe(0);
    await expect(getCustomerImport(shop.owner, id)).resolves.toMatchObject({ status: 'DRAFT' });

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: id },
        select: { entityType: true },
      }),
    );
    expect(events.map((event) => event.entityType)).toContain('CustomerImport');
  });

  it('una bozza dimenticata da più di un giorno si chiude con la manutenzione', async () => {
    const { id } = await createCustomerImport(shop.manager, {
      fileName: 'olvidado.csv',
      content: 'Nombre,Teléfono\nOlvidada,4495550377\n',
    });
    await withSystemContext(db, { reason: 'test: bozza di due giorni fa' }, (tx) =>
      tx.customerImport.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      }),
    );
    // Il conto non si controlla: la manutenzione di un altro test può averla già chiusa.
    await closeStaleCustomerImports();
    const stored = await withSystemContext(db, { reason: 'test: bozza chiusa' }, (tx) =>
      tx.customerImport.findUniqueOrThrow({
        where: { id },
        select: { status: true, content: true, completedAt: true },
      }),
    );
    expect(stored).toMatchObject({ status: 'CANCELLED', content: '' });
    expect(stored.completedAt).not.toBeNull();
    expect(await findOpenCustomerImport(shop.manager)).toBeNull();
  });
});
