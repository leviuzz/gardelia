/**
 * Import dei clienti da un file CSV [CRM-01, ADR-070 blocco 3]: regole pure, senza I/O.
 *
 *  - Lettura del file (RFC 4180): separatore riconosciuto (virgola, punto e virgola, tabulazione),
 *    BOM, campi fra virgolette con a capo e virgolette doppie; UTF-8 oppure Windows-1252 (Excel).
 *  - Colonne riconosciute dal nome nelle tre lingue dell'interfaccia, poi correggibili a mano.
 *  - Ogni riga si valida come il modulo "Nuevo cliente"; compleanno e aniversario diventano date
 *    speciali. I duplicati (telefono o email già nella fioreria o ripetuti nel file) si saltano.
 *  - Nessun consenso marketing: si segna a mano, uno per uno (founder, 23/11/2026; LFPDPPP).
 */
import { z } from 'zod';
import {
  CUSTOMER_LIMITS,
  customerFormSchema,
  isValidMonthDay,
  type CustomerInput,
  type OccasionInput,
} from './customer';
import type { MarketCountry } from './markets';
import { toFieldErrors, type FieldErrors } from './validation';

export const CUSTOMER_IMPORT_LIMITS = {
  /** Righe di dati per file (intestazione esclusa). */
  rows: 1000,
  /** Dimensione massima del file, in byte. */
  bytes: 512 * 1024,
  /** Colonne lette per riga. */
  columns: 40,
  /** Lunghezza del nome del file salvato. */
  fileName: 120,
  /** Righe con problemi elencate nell'anteprima. */
  problemsShown: 100,
  /** Righe valide mostrate come esempio nell'anteprima. */
  samplesShown: 5,
} as const;

/** I dati di un cliente che si possono leggere da una colonna del file. */
export const CUSTOMER_IMPORT_FIELDS = [
  'displayName',
  'type',
  'phone',
  'email',
  'legalName',
  'taxId',
  'notes',
  'preferences',
  'restrictions',
  'tags',
  'birthday',
  'anniversary',
] as const;
export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];

/** Colonne del modello da scaricare, nell'ordine. */
export const CUSTOMER_IMPORT_TEMPLATE_FIELDS: readonly CustomerImportField[] = [
  'displayName',
  'phone',
  'email',
  'type',
  'birthday',
  'anniversary',
  'tags',
  'notes',
];

// -----------------------------------------------------------------------------
// Lettura del file
// -----------------------------------------------------------------------------

/**
 * Testo del file: UTF-8 (con o senza BOM) e, se non è UTF-8 valido, Windows-1252, la codifica
 * con cui Excel salva spesso i CSV in spagnolo ("Cumpleaños", "Teléfono").
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export type CsvDelimiter = ',' | ';' | '\t';
const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

/** Il separatore più frequente nella prima riga, fuori dalle virgolette (virgola se nessuno). */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let inQuotes = false;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === '\n' || char === '\r')) break;
    else if (!inQuotes && counts.has(char as CsvDelimiter)) {
      counts.set(char as CsvDelimiter, (counts.get(char as CsvDelimiter) ?? 0) + 1);
    }
  }
  let best: CsvDelimiter = ',';
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/**
 * Righe e celle di un CSV (RFC 4180, tollerante): virgolette doppie per i campi con separatori o a
 * capo, `""` per una virgoletta; una virgoletta in mezzo a un campo senza virgolette resta com'è.
 * Le righe vuote in mezzo restano (vuote), così il numero di riga è quello del foglio di calcolo;
 * quelle in fondo si tolgono.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectCsvDelimiter(text)) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  const source = text.replace(/^\uFEFF/, '');

  function endField() {
    row.push(quotedField ? field : field.trim());
    field = '';
    quotedField = false;
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field.trim() === '' && !quotedField) {
      inQuotes = true;
      quotedField = true;
      field = '';
    } else if (char === delimiter) {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      endRow();
    } else if (!quotedField) {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  while (rows.length > 0 && isBlankRow(rows[rows.length - 1] ?? [])) rows.pop();
  return rows;
}

/** Riga senza alcun valore (riga vuota del foglio di calcolo). */
export function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

// -----------------------------------------------------------------------------
// Colonne
// -----------------------------------------------------------------------------

/** Nome di colonna confrontabile: senza accenti, minuscolo, solo lettere e cifre. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nomi di colonna riconosciuti (spagnolo, italiano, inglese), già normalizzati. */
const HEADER_ALIASES: Readonly<Record<CustomerImportField, readonly string[]>> = {
  displayName: [
    'nombre',
    'nombre completo',
    'nombre del cliente',
    'cliente',
    'name',
    'full name',
    'customer',
    'customer name',
    'nome',
    'nome completo',
    'nome e cognome',
  ],
  type: ['tipo', 'tipo de cliente', 'type', 'customer type', 'tipo cliente'],
  phone: [
    'telefono',
    'tel',
    'celular',
    'movil',
    'whatsapp',
    'numero de telefono',
    'phone',
    'phone number',
    'mobile',
    'cellulare',
    'numero di telefono',
  ],
  email: ['email', 'e mail', 'correo', 'correo electronico', 'mail', 'email address'],
  legalName: ['razon social', 'legal name', 'ragione sociale'],
  taxId: ['rfc', 'tax id', 'partita iva', 'codice fiscale'],
  notes: ['notas', 'nota', 'comentarios', 'notes', 'comments', 'note'],
  preferences: ['preferencias', 'gustos', 'preferences', 'preferenze'],
  restrictions: [
    'restricciones',
    'alergias',
    'restrictions',
    'allergies',
    'restrizioni',
    'allergie',
  ],
  tags: ['etiquetas', 'etiqueta', 'tags', 'tag', 'etichette', 'etichetta'],
  birthday: [
    'cumpleanos',
    'fecha de nacimiento',
    'nacimiento',
    'birthday',
    'date of birth',
    'birth date',
    'compleanno',
    'data di nascita',
  ],
  anniversary: ['aniversario', 'anniversary', 'anniversario'],
};

/** Colonna → dato del cliente (null: si ignora), dedotto dai nomi; ogni dato una volta sola. */
export function suggestCustomerImportMapping(
  headers: readonly string[],
): (CustomerImportField | null)[] {
  const used = new Set<CustomerImportField>();
  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    const field = CUSTOMER_IMPORT_FIELDS.find(
      (candidate) => !used.has(candidate) && HEADER_ALIASES[candidate].includes(normalized),
    );
    if (!field) return null;
    used.add(field);
    return field;
  });
}

/**
 * Colonne scelte dalla persona (`column.0`, `column.1`, …): "" o assente → ignorata. Il nome è
 * obbligatorio e ogni dato può venire da una sola colonna.
 */
export function customerImportMappingSchema(columnCount: number) {
  return z
    .array(
      z.preprocess(
        (value) => (value === '' || value === undefined || value === null ? null : value),
        z.enum(CUSTOMER_IMPORT_FIELDS, { error: 'invalid_option' }).nullable(),
      ),
    )
    .length(columnCount, { error: 'invalid_option' })
    .superRefine((mapping, ctx) => {
      if (!mapping.includes('displayName')) {
        ctx.addIssue({ code: 'custom', message: 'customers_import_name_column', path: [] });
      }
      const seen = new Set<CustomerImportField>();
      mapping.forEach((field, index) => {
        if (field === null) return;
        if (seen.has(field)) {
          ctx.addIssue({
            code: 'custom',
            message: 'customers_import_repeated_column',
            path: [index],
          });
        }
        seen.add(field);
      });
    });
}
export type CustomerImportMapping = readonly (CustomerImportField | null)[];

// -----------------------------------------------------------------------------
// Righe
// -----------------------------------------------------------------------------

/** Tipo di cliente scritto nel file: vuoto → persona. */
function importType(value: string): string {
  const normalized = normalizeHeader(value);
  if (
    ['', 'persona', 'persona fisica', 'person', 'individual', 'privato', 'fisica'].includes(
      normalized,
    )
  )
    return 'PERSON';
  if (
    ['empresa', 'negocio', 'persona moral', 'moral', 'company', 'business', 'azienda'].includes(
      normalized,
    )
  )
    return 'COMPANY';
  return value;
}

/**
 * Data di compleanno o aniversario: "14/02", "14/02/1990", "14-02-1990", "14.02.1990" (giorno
 * prima, come in Messico) oppure "1990-02-14". Vuota → null; non valida → 'invalid'.
 */
export function parseImportDate(
  value: string,
):
  | { readonly month: number; readonly day: number; readonly year: number | null }
  | null
  | 'invalid' {
  const text = value.trim();
  if (text === '') return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(text);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : dayFirst
      ? {
          day: Number(dayFirst[1]),
          month: Number(dayFirst[2]),
          year: dayFirst[3] ? Number(dayFirst[3]) : null,
        }
      : null;
  if (!parts || !isValidMonthDay(parts.month, parts.day)) return 'invalid';
  if (parts.year !== null) {
    if (parts.year < 1900 || parts.year > 2100) return 'invalid';
    // Il 29 febbraio solo negli anni bisestili.
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (date.getUTCMonth() !== parts.month - 1) return 'invalid';
  }
  return parts;
}

/** Una riga del file pronta da salvare. */
export interface CustomerImportCandidate {
  /** Riga del file (la prima è l'intestazione). */
  readonly line: number;
  readonly customer: CustomerInput;
  readonly occasions: readonly OccasionInput[];
}

export type CustomerImportRow =
  | ({ readonly kind: 'ok' } & CustomerImportCandidate)
  | {
      readonly kind: 'invalid';
      readonly line: number;
      readonly displayName: string;
      /** Campo del file → codice di validazione (`required`, `invalid_phone`…). */
      readonly errors: FieldErrors;
    };

/** Le celle di una riga, per dato del cliente. */
function cellsByField(cells: readonly string[], mapping: CustomerImportMapping) {
  const values: Partial<Record<CustomerImportField, string>> = {};
  mapping.forEach((field, index) => {
    if (field) values[field] = (cells[index] ?? '').trim();
  });
  return values;
}

/**
 * Valida le righe di dati (senza intestazione) con le colonne scelte. Le righe senza alcun dato
 * nelle colonne usate si saltano. Il consenso marketing è sempre falso.
 */
export function readCustomerImportRows(
  dataRows: readonly (readonly string[])[],
  mapping: CustomerImportMapping,
  country: MarketCountry,
): CustomerImportRow[] {
  const schema = customerFormSchema(country);
  const result: CustomerImportRow[] = [];
  dataRows.forEach((cells, index) => {
    const line = index + 2;
    const values = cellsByField(cells, mapping);
    if (Object.values(values).every((value) => value === '')) return;
    const parsed = schema.safeParse({
      type: importType(values.type ?? ''),
      displayName: values.displayName ?? '',
      legalName: values.legalName ?? '',
      taxId: values.taxId ?? '',
      email: values.email ?? '',
      phone: values.phone ?? '',
      notes: values.notes ?? '',
      preferences: values.preferences ?? '',
      restrictions: values.restrictions ?? '',
      // Nella cella le etichette possono essere separate da virgola, punto e virgola o barra.
      tags: (values.tags ?? '').split(/[;,|]/).join(','),
      acquisitionChannel: '',
      marketingConsent: '',
    });
    const errors: FieldErrors = parsed.success ? {} : { ...toFieldErrors(parsed.error) };
    const occasions: OccasionInput[] = [];
    for (const [field, type] of [
      ['birthday', 'BIRTHDAY'],
      ['anniversary', 'ANNIVERSARY'],
    ] as const) {
      const date = parseImportDate(values[field] ?? '');
      if (date === 'invalid') errors[field] = 'invalid_date';
      else if (date) {
        occasions.push({
          type,
          label: null,
          personName: null,
          month: date.month,
          day: date.day,
          year: date.year,
          remindDaysBefore: 7,
          notes: null,
        });
      }
    }
    if (!parsed.success || Object.keys(errors).length > 0) {
      result.push({
        kind: 'invalid',
        line,
        displayName: (values.displayName ?? '').slice(0, CUSTOMER_LIMITS.displayName),
        errors,
      });
      return;
    }
    result.push({ kind: 'ok', line, customer: parsed.data, occasions });
  });
  return result;
}

/** Perché una riga valida non si importa: c'è già un cliente con lo stesso telefono o email. */
export type CustomerImportDuplicate =
  | { readonly reason: 'existing'; readonly customerId: string; readonly customerName: string }
  | { readonly reason: 'file'; readonly firstLine: number };

export interface ExistingCustomerContact {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly email: string | null;
}

/**
 * Duplicati: stesso telefono (già normalizzato) o stessa email di un cliente della fioreria, oppure
 * di una riga precedente del file (vale la prima).
 */
export function findCustomerImportDuplicates(
  candidates: readonly CustomerImportCandidate[],
  existing: readonly ExistingCustomerContact[],
): Map<number, CustomerImportDuplicate> {
  const byPhone = new Map<string, ExistingCustomerContact>();
  const byEmail = new Map<string, ExistingCustomerContact>();
  for (const customer of existing) {
    if (customer.phone) byPhone.set(customer.phone, customer);
    if (customer.email) byEmail.set(customer.email.toLowerCase(), customer);
  }
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const duplicates = new Map<number, CustomerImportDuplicate>();
  for (const candidate of candidates) {
    const { phone, email } = candidate.customer;
    const match = (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
    if (match) {
      duplicates.set(candidate.line, {
        reason: 'existing',
        customerId: match.id,
        customerName: match.displayName,
      });
      continue;
    }
    const firstLine = (phone && seenPhone.get(phone)) || (email && seenEmail.get(email)) || null;
    if (firstLine) {
      duplicates.set(candidate.line, { reason: 'file', firstLine });
      continue;
    }
    if (phone) seenPhone.set(phone, candidate.line);
    if (email) seenEmail.set(email, candidate.line);
  }
  return duplicates;
}

/**
 * Testo del modello da scaricare: solo l'intestazione, nella lingua di chi lo usa. Nessuna riga
 * d'esempio: dimenticata nel file, diventerebbe un cliente vero.
 */
export function customerImportTemplate(headers: Readonly<Record<CustomerImportField, string>>) {
  const quote = (value: string) =>
    /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `${CUSTOMER_IMPORT_TEMPLATE_FIELDS.map((field) => quote(headers[field])).join(',')}\r\n`;
}
