/**
 * Mattoni di validazione condivisi (Zod 4).
 *
 * I messaggi d'errore sono CODICI (es. "required", "invalid_money"), non testo:
 * la UI li traduce con le chiavi `validation.<codice>` del file di lingua.
 * Così la stessa regola produce messaggi coerenti in es-MX oggi e in it-IT domani.
 */
import { z } from 'zod';
import { parseMoneyInput, type CurrencyCode } from './money';

export const VALIDATION_CODES = [
  'required',
  'too_long',
  'invalid_email',
  'invalid_money',
  'too_many_decimals',
  'amount_too_large',
  'invalid_number',
  'out_of_range',
  'invalid_option',
  'invalid_postal_code',
  'invalid_phone',
  'invalid_tax_id',
  'invalid_sku',
  'unit_not_allowed_for_type',
  'canonical_not_allowed_for_type',
  'too_many_items',
  'invalid_date',
  'discount_exceeds_subtotal',
  'item_unavailable',
  'builder_needs_flower',
  'builder_one_packaging',
  'builder_line_limit',
  'builder_item_not_allowed',
  'builder_color_required',
  'file_required',
  'file_too_large',
  'invalid_image',
  'image_too_small',
  'too_many_photos',
  'photos_not_allowed_for_type',
  'consent_required',
  'invalid_time_window',
  'payment_exceeds_balance',
  /** Inventario (ADR-060): nessun prodotto con la quantità in "Elegir productos". */
  'inventory_none_selected',
  /** Inventario (ADR-061): una compra senza righe. */
  'inventory_no_lines',
  /** Inventario (ADR-062): scadenza di un apartado già passata o oltre i 90 giorni. */
  'inventory_expiry_past',
  'inventory_expiry_too_far',
  /** Inventario (ADR-062): "Usar apartado" con tutte le quantità a 0. */
  'inventory_nothing_used',
  /** Clienti (ADR-070): "Agregar etiqueta" senza clienti scelti. */
  'customers_none_selected',
  /** Import di clienti da CSV (ADR-070): file e colonne. */
  'customers_import_empty',
  'customers_import_too_big',
  'customers_import_too_many_rows',
  'customers_import_too_many_columns',
  'customers_import_name_column',
  'customers_import_repeated_column',
  'invalid',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

/** Normalizza i valori grezzi dei form: stringhe ripulite, assenti → stringa vuota. */
export function toTrimmedString(value: unknown): unknown {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return value;
}

/** Testo obbligatorio con lunghezza massima. */
export function requiredText(max: number) {
  return z.preprocess(
    toTrimmedString,
    z.string({ error: 'required' }).min(1, { error: 'required' }).max(max, { error: 'too_long' }),
  );
}

/** Testo facoltativo: stringa vuota → null. */
export function optionalText(max: number) {
  return z.preprocess(
    toTrimmedString,
    z
      .string({ error: 'invalid' })
      .max(max, { error: 'too_long' })
      .transform((value) => (value === '' ? null : value)),
  );
}

/** Email facoltativa, normalizzata in minuscolo; stringa vuota → null. */
export function optionalEmail() {
  return z.preprocess(
    (value) => {
      const trimmed = toTrimmedString(value);
      return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
    },
    z.union([z.literal('').transform(() => null), z.email({ error: 'invalid_email' }).max(254)]),
  );
}

interface IntegerFieldOptions {
  readonly min: number;
  readonly max: number;
}

function parseIntegerInput(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Intero obbligatorio da un campo di form. */
export function requiredInteger({ min, max }: IntegerFieldOptions) {
  return z.preprocess(
    toTrimmedString,
    z.string().transform((value, ctx) => {
      if (value === '') {
        ctx.addIssue({ code: 'custom', message: 'required' });
        return z.NEVER;
      }
      const parsed = parseIntegerInput(value);
      if (parsed === null) {
        ctx.addIssue({ code: 'custom', message: 'invalid_number' });
        return z.NEVER;
      }
      if (parsed < min || parsed > max) {
        ctx.addIssue({ code: 'custom', message: 'out_of_range' });
        return z.NEVER;
      }
      return parsed;
    }),
  );
}

/** Intero facoltativo da un campo di form: vuoto → null. */
export function optionalInteger({ min, max }: IntegerFieldOptions) {
  return z.preprocess(
    toTrimmedString,
    z.string().transform((value, ctx) => {
      if (value === '') return null;
      const parsed = parseIntegerInput(value);
      if (parsed === null) {
        ctx.addIssue({ code: 'custom', message: 'invalid_number' });
        return z.NEVER;
      }
      if (parsed < min || parsed > max) {
        ctx.addIssue({ code: 'custom', message: 'out_of_range' });
        return z.NEVER;
      }
      return parsed;
    }),
  );
}

/** Importo obbligatorio da un campo di form → unità minime. */
export function moneyField(currency: CurrencyCode) {
  return z.preprocess(
    toTrimmedString,
    z.string().transform((value, ctx) => {
      const result = parseMoneyInput(value, currency);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.error });
        return z.NEVER;
      }
      return result.minor;
    }),
  );
}

/** Importo facoltativo da un campo di form: vuoto → null. */
export function optionalMoneyField(currency: CurrencyCode) {
  return z.preprocess(
    toTrimmedString,
    z.string().transform((value, ctx) => {
      if (value === '') return null;
      const result = parseMoneyInput(value, currency);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.error });
        return z.NEVER;
      }
      return result.minor;
    }),
  );
}

/** Checkbox HTML: "on"/"true" → true, assente → false. */
export function checkboxField() {
  return z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean());
}

/** Campo che può arrivare come valore singolo o ripetuto (checkbox multipli). */
export function multiValueField<T extends z.ZodType>(item: T, maxItems: number) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return [];
      return Array.isArray(value) ? value : [value];
    },
    z.array(item).max(maxItems, { error: 'too_many_items' }),
  );
}

/**
 * Etichette libere separate da virgola ("boda, aniversario") → array normalizzato
 * (minuscolo, senza duplicati).
 */
export function tagsField(maxItems: number, maxLength: number) {
  return z.preprocess(
    (value) => {
      const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
      const tags = raw
        .split(',')
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter((tag) => tag.length > 0);
      return Array.from(new Set(tags));
    },
    z
      .array(z.string().max(maxLength, { error: 'too_long' }))
      .max(maxItems, { error: 'too_many_items' }),
  );
}

/** Errori di validazione per campo, con il primo codice di ciascun campo. */
export type FieldErrors = Partial<Record<string, ValidationCode | string>>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_form';
    if (result[key] === undefined) result[key] = issue.message;
  }
  return result;
}
