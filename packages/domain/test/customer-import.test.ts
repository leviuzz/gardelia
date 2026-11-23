import { describe, expect, it } from 'vitest';
import {
  customerImportMappingSchema,
  customerImportTemplate,
  decodeCsvBytes,
  detectCsvDelimiter,
  findCustomerImportDuplicates,
  parseCsv,
  parseImportDate,
  readCustomerImportRows,
  suggestCustomerImportMapping,
  type CustomerImportCandidate,
} from '../src/customer-import';
import { toFieldErrors } from '../src/validation';

describe('lettura del file CSV', () => {
  it('UTF-8 con BOM e Windows-1252 di Excel', () => {
    const utf8 = new TextEncoder().encode('\uFEFFNombre,Cumpleaños\n');
    expect(decodeCsvBytes(utf8)).toBe('Nombre,Cumpleaños\n');
    // "Cumpleaños" salvato da Excel in ANSI: ñ = 0xF1, non è UTF-8 valido.
    const ansi = Uint8Array.from([0x43, 0x75, 0x6d, 0x70, 0x6c, 0x65, 0x61, 0xf1, 0x6f, 0x73]);
    expect(decodeCsvBytes(ansi)).toBe('Cumpleaños');
  });

  it('riconosce il separatore dalla prima riga, fuori dalle virgolette', () => {
    expect(detectCsvDelimiter('Nombre;Teléfono;"Notas, varias"\nAna;1;2')).toBe(';');
    expect(detectCsvDelimiter('Nombre\tTeléfono\nAna\t1')).toBe('\t');
    expect(detectCsvDelimiter('Nombre,Teléfono\nAna;Beto;Carla;Dora')).toBe(',');
    expect(detectCsvDelimiter('Nombre')).toBe(',');
  });

  it('virgolette, a capo dentro una cella, virgolette doppie; righe vuote come nel foglio', () => {
    const text =
      'Nombre,Notas\r\n' +
      '  Ana Torres  ,"Le gustan las rosas, no los lirios"\r\n' +
      '\r\n' +
      'Beto,"Dos\nlíneas"\n' +
      'Carla,"Dice ""hola"""\n' +
      ',\n';
    // La riga vuota in mezzo resta (i numeri di riga sono quelli del foglio); quella in fondo no.
    expect(parseCsv(text)).toEqual([
      ['Nombre', 'Notas'],
      ['Ana Torres', 'Le gustan las rosas, no los lirios'],
      [''],
      ['Beto', 'Dos\nlíneas'],
      ['Carla', 'Dice "hola"'],
    ]);
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    // Una virgoletta in mezzo a un campo senza virgolette resta com'è.
    expect(parseCsv('Nombre\nFlorería "La Rosa"\n')).toEqual([['Nombre'], ['Florería "La Rosa"']]);
  });
});

describe('colonne', () => {
  it('riconosce i nomi nelle tre lingue, senza accenti né maiuscole', () => {
    expect(
      suggestCustomerImportMapping([
        'Nombre',
        'Teléfono',
        'Correo electrónico',
        'CUMPLEAÑOS',
        'Etiquetas',
        'Columna rara',
      ]),
    ).toEqual(['displayName', 'phone', 'email', 'birthday', 'tags', null]);
    expect(suggestCustomerImportMapping(['Nome e cognome', 'Cellulare', 'Compleanno'])).toEqual([
      'displayName',
      'phone',
      'birthday',
    ]);
    expect(suggestCustomerImportMapping(['Full name', 'Phone', 'E-mail', 'Anniversary'])).toEqual([
      'displayName',
      'phone',
      'email',
      'anniversary',
    ]);
    // Lo stesso dato due volte: vale la prima colonna.
    expect(suggestCustomerImportMapping(['Teléfono', 'Celular'])).toEqual(['phone', null]);
  });

  it('il nome è obbligatorio e ogni dato viene da una sola colonna', () => {
    const schema = customerImportMappingSchema(3);
    expect(schema.parse(['displayName', '', 'phone'])).toEqual(['displayName', null, 'phone']);
    const noName = schema.safeParse(['phone', '', '']);
    expect(noName.success).toBe(false);
    if (!noName.success) {
      expect(toFieldErrors(noName.error)).toEqual({ _form: 'customers_import_name_column' });
    }
    const repeated = schema.safeParse(['displayName', 'phone', 'phone']);
    expect(repeated.success).toBe(false);
    if (!repeated.success) {
      expect(toFieldErrors(repeated.error)).toEqual({ '2': 'customers_import_repeated_column' });
    }
    expect(schema.safeParse(['displayName', 'boh', '']).success).toBe(false);
    expect(schema.safeParse(['displayName']).success).toBe(false);
  });
});

describe('date di compleanno e aniversario', () => {
  it('giorno prima del mese, oppure AAAA-MM-GG; anno facoltativo', () => {
    expect(parseImportDate('14/02')).toEqual({ day: 14, month: 2, year: null });
    expect(parseImportDate('14/02/1990')).toEqual({ day: 14, month: 2, year: 1990 });
    expect(parseImportDate('1990-02-14')).toEqual({ day: 14, month: 2, year: 1990 });
    expect(parseImportDate('4.7.1985')).toEqual({ day: 4, month: 7, year: 1985 });
    expect(parseImportDate('29/02')).toEqual({ day: 29, month: 2, year: null });
    expect(parseImportDate(' ')).toBeNull();
    for (const invalid of ['29/02/2023', '31/04', '13/13', '14/02/1800', 'mañana', '02-14']) {
      expect([invalid, parseImportDate(invalid)]).toEqual([invalid, 'invalid']);
    }
  });
});

describe('righe del file', () => {
  const mapping = [
    'displayName',
    'phone',
    'email',
    'type',
    'tags',
    'birthday',
    'anniversary',
  ] as const;

  it('valide come nel modulo "Nuevo cliente", senza consenso marketing', () => {
    const rows = readCustomerImportRows(
      [
        ['Ana Torres', '449 555 0142', 'ANA@Example.com', '', 'VIP; bodas|vip', '14/02', ''],
        ['Hotel Casa Fuentes', '', '', 'Empresa', '', '', '2015-06-20'],
        ['', '', '', '', '', '', ''],
        ['', '449 555 0100', 'no-es-email', 'cooperativa', '', '31/04', ''],
      ],
      mapping,
      'MX',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'ok',
      line: 2,
      customer: {
        type: 'PERSON',
        displayName: 'Ana Torres',
        phone: '+524495550142',
        email: 'ana@example.com',
        tags: ['vip', 'bodas'],
        marketingConsent: false,
        acquisitionChannel: null,
      },
      occasions: [{ type: 'BIRTHDAY', month: 2, day: 14, year: null, remindDaysBefore: 7 }],
    });
    expect(rows[1]).toMatchObject({
      kind: 'ok',
      line: 3,
      customer: { type: 'COMPANY', displayName: 'Hotel Casa Fuentes', phone: null },
      occasions: [{ type: 'ANNIVERSARY', month: 6, day: 20, year: 2015 }],
    });
    // La riga vuota (4) si salta; la 5 ha più errori, ciascuno sul suo campo.
    expect(rows[2]).toEqual({
      kind: 'invalid',
      line: 5,
      displayName: '',
      errors: {
        displayName: 'required',
        email: 'invalid_email',
        type: 'invalid_option',
        birthday: 'invalid_date',
      },
    });
  });

  it('duplicati: telefono o email già della fioreria, o ripetuti più su nel file', () => {
    const rows = readCustomerImportRows(
      [
        ['Ana', '449 555 0142', '', '', '', '', ''],
        ['Beto', '', 'beto@example.com', '', '', '', ''],
        ['Carla', '4495550199', '', '', '', '', ''],
        ['Carla bis', '+52 449 555 0199', '', '', '', '', ''],
        ['Dora', '', 'dora@example.com', '', '', '', ''],
      ],
      mapping,
      'MX',
    );
    const candidates = rows.filter(
      (row): row is CustomerImportCandidate & { kind: 'ok' } => row.kind === 'ok',
    );
    const duplicates = findCustomerImportDuplicates(candidates, [
      { id: 'c1', displayName: 'Ana Torres', phone: '+524495550142', email: null },
      { id: 'c2', displayName: 'Beto Ruiz', phone: null, email: 'BETO@example.com' },
    ]);
    expect([...duplicates]).toEqual([
      [2, { reason: 'existing', customerId: 'c1', customerName: 'Ana Torres' }],
      [3, { reason: 'existing', customerId: 'c2', customerName: 'Beto Ruiz' }],
      [5, { reason: 'file', firstLine: 4 }],
    ]);
  });
});

describe('modello da scaricare', () => {
  it("solo l'intestazione nella lingua scelta, che si rilegge da sola", () => {
    const template = customerImportTemplate({
      displayName: 'Nombre',
      type: 'Tipo',
      phone: 'Teléfono',
      email: 'Email',
      legalName: 'Razón social',
      taxId: 'RFC',
      notes: 'Notas, varias',
      preferences: 'Preferencias',
      restrictions: 'Restricciones',
      tags: 'Etiquetas',
      birthday: 'Cumpleaños',
      anniversary: 'Aniversario',
    });
    expect(template).toBe(
      'Nombre,Teléfono,Email,Tipo,Cumpleaños,Aniversario,Etiquetas,"Notas, varias"\r\n',
    );
    expect(suggestCustomerImportMapping(parseCsv(template)[0] ?? [])).toEqual([
      'displayName',
      'phone',
      'email',
      'type',
      'birthday',
      'anniversary',
      'tags',
      null,
    ]);
  });
});
