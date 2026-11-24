import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsv } from '../src/index';

/** CSV dell'esportazione (ADR-079): Excel li apre bene e nessun testo diventa una formula. */
describe('CSV da scaricare', () => {
  it('virgolette solo quando servono; BOM e righe CRLF', () => {
    const csv = toCsv(
      [
        { header: 'Nombre', value: (row: { name: string; total: string }) => row.name },
        { header: 'Total', value: (row) => row.total, numeric: true },
      ],
      [
        { name: 'Ana, la de "Las Rosas"', total: '690.00' },
        { name: 'Línea\nnueva', total: '-35.50' },
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe(
      '﻿Nombre,Total\r\n"Ana, la de ""Las Rosas""",690.00\r\n"Línea\nnueva",-35.50\r\n',
    );
    // Si rilegge con lo stesso parser dell'import dei clienti.
    expect(parseCsv(csv.slice(1), ',')).toEqual([
      ['Nombre', 'Total'],
      ['Ana, la de "Las Rosas"', '690.00'],
      ['Línea\nnueva', '-35.50'],
    ]);
  });

  it('un testo che sembra una formula resta testo; i numeri no', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe('"\'=HYPERLINK(""http://x"",""clic"")"');
    expect(csvCell('+52 449 555 0101')).toBe("'+52 449 555 0101");
    expect(csvCell('@cliente')).toBe("'@cliente");
    expect(csvCell('-35.50', true)).toBe('-35.50');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });
});
