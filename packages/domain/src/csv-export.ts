/**
 * CSV da scaricare (esportazione dei dati della fioreria, ADR-079): si aprono con Excel o Google
 * Sheets. UTF-8 con BOM (Excel riconosce gli accenti), righe CRLF, campi fra virgolette quando
 * servono (RFC 4180).
 *
 * Sicurezza: un testo che comincia con `=`, `+`, `-`, `@`, tab o a capo verrebbe letto da Excel
 * come una formula (CSV injection, es. un cliente chiamato `=HYPERLINK(…)`): si fa precedere da un
 * apostrofo. Le colonne numeriche (importi, quantità) non si toccano: lì il "-" è un segno.
 */

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | null | undefined;
  /** Numeri e importi già scritti dal server: nessuna protezione per le formule. */
  readonly numeric?: boolean;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Byte order mark: Excel lo usa per capire che il file è UTF-8. */
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: string | number | null | undefined, numeric = false): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!numeric && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Il file intero: BOM, intestazione e una riga per elemento. */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row), column.numeric)).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
