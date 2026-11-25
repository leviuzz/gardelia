import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_ORDER_LIMITS,
  STORE_LIMITS,
  addDays,
  addToCart,
  dayOfWeek,
  deliveryFeeSummary,
  firstOrderableDate,
  marketplaceDateProblem,
  movePhotoId,
  parseCart,
  parseStorefrontQuery,
  planStorefront,
  serializeCart,
  setCartLine,
  storePoliciesSchema,
  storefrontCategoryOf,
  type CalendarDate,
  type StorefrontRow,
} from '../src/index';

/** Vetrina della fioreria (blocco M1, ADR-087). */

const uuid = (n: number) => `0192f5c1-6b2f-7000-8000-${String(n).padStart(12, '0')}`;

function row(n: number, overrides: Partial<StorefrontRow> = {}): StorefrontRow {
  return {
    id: uuid(n),
    type: 'BOUQUET',
    name: `Ramo ${String(n).padStart(3, '0')}`,
    priceMinor: 10_000 + n,
    availability: 'AVAILABLE',
    featuredAt: null,
    ...overrides,
  };
}

const query = (raw: Record<string, unknown> = {}) => parseStorefrontQuery(raw);

describe("parametri dell'indirizzo", () => {
  it('predefiniti e valori sbagliati non sono errori', () => {
    expect(query()).toEqual({
      categoria: undefined,
      q: undefined,
      orden: 'recomendados',
      pagina: 1,
    });
    expect(query({ categoria: 'zapatos', orden: 'barato', pagina: '-3', q: '   ' })).toEqual({
      categoria: undefined,
      q: undefined,
      orden: 'recomendados',
      pagina: 1,
    });
    expect(parseStorefrontQuery(null)).toMatchObject({ pagina: 1 });
  });

  it('valori ripetuti: vale il primo; la ricerca si taglia a 60 caratteri', () => {
    const parsed = query({
      categoria: ['plantas', 'ramos'],
      orden: 'precio-desc',
      pagina: '3',
      q: `  ${'a'.repeat(80)}  `,
    });
    expect(parsed).toMatchObject({ categoria: 'plantas', orden: 'precio-desc', pagina: 3 });
    expect(parsed.q).toHaveLength(60);
  });

  it('le schede corrispondono ai tipi online', () => {
    expect(storefrontCategoryOf('BOUQUET')).toBe('ramos');
    expect(storefrontCategoryOf('PLANT')).toBe('plantas');
    expect(storefrontCategoryOf('FOLIAGE')).toBeNull();
  });
});

describe('vetrina', () => {
  it('schede con i conteggi, ricerca senza accenti e per scheda', () => {
    const rows = [
      row(1, { name: 'Orquídea blanca', type: 'PLANT' }),
      row(2, { name: 'Ramo de rosas' }),
      row(3, { name: 'Globo', type: 'ACCESSORY' }),
    ];
    const all = planStorefront(rows, query());
    expect(all.categories).toEqual([
      { category: 'ramos', count: 1 },
      { category: 'plantas', count: 1 },
      { category: 'accesorios', count: 1 },
    ]);
    expect(planStorefront(rows, query({ q: 'orquidea' })).itemIds).toEqual([uuid(1)]);
    expect(planStorefront(rows, query({ q: 'ROSAS' })).itemIds).toEqual([uuid(2)]);
    expect(planStorefront(rows, query({ categoria: 'accesorios' })).itemIds).toEqual([uuid(3)]);
    const none = planStorefront(rows, query({ q: 'tulipán' }));
    expect(none).toMatchObject({ total: 0, page: 1, pageCount: 1, itemIds: [] });
  });

  it('ordini: gli esauriti sempre in fondo', () => {
    const rows = [
      row(1, { name: 'Cesta', priceMinor: 300 }),
      row(2, { name: 'Alba', priceMinor: 100, availability: 'OUT_OF_STOCK' }),
      row(3, { name: 'Bella', priceMinor: 200 }),
    ];
    expect(planStorefront(rows, query({ orden: 'nombre' })).itemIds).toEqual([
      uuid(3),
      uuid(1),
      uuid(2),
    ]);
    expect(planStorefront(rows, query({ orden: 'precio-asc' })).itemIds).toEqual([
      uuid(3),
      uuid(1),
      uuid(2),
    ]);
    expect(planStorefront(rows, query({ orden: 'precio-desc' })).itemIds).toEqual([
      uuid(1),
      uuid(3),
      uuid(2),
    ]);
  });

  it('pagine da 24; una pagina troppo alta mostra l’ultima', () => {
    const rows = Array.from({ length: 50 }, (_, index) => row(index + 1));
    const second = planStorefront(rows, query({ pagina: '2' }));
    expect(second).toMatchObject({ total: 50, page: 2, pageCount: 3 });
    expect(second.itemIds[0]).toBe(uuid(25));
    expect(planStorefront(rows, query({ pagina: '9' }))).toMatchObject({ page: 3 });
    expect(planStorefront(rows, query({ pagina: '9' })).itemIds).toEqual([uuid(49), uuid(50)]);
  });

  it('«Destacados»: al massimo 8, mai esauriti, nell’ordine di scelta e non ripetuti', () => {
    const chosen = (minutes: number) => new Date(Date.UTC(2026, 10, 25, 10, minutes));
    const rows = [
      ...Array.from({ length: 10 }, (_, index) =>
        row(index + 1, { featuredAt: chosen(10 - index) }),
      ),
      row(11, { featuredAt: chosen(0), availability: 'OUT_OF_STOCK' }),
      row(12),
    ];
    const home = planStorefront(rows, query());
    expect(home.featuredIds).toHaveLength(STORE_LIMITS.featured);
    // Scelto per primo = minuti più bassi = l'ultimo dell'elenco.
    expect(home.featuredIds[0]).toBe(uuid(10));
    expect(home.featuredIds).not.toContain(uuid(11));
    expect(home.itemIds.some((id) => home.featuredIds.includes(id))).toBe(false);
    // I due in evidenza rimasti fuori dalla riga vengono prima degli altri; l'esaurito in fondo.
    expect(home.itemIds).toEqual([uuid(2), uuid(1), uuid(12), uuid(11)]);
    expect(home.total).toBe(12);

    // Con un filtro o un altro ordine niente riga: chi è in evidenza sta nella griglia.
    const filtered = planStorefront(rows, query({ categoria: 'ramos' }));
    expect(filtered.featuredIds).toEqual([]);
    expect(filtered.itemIds[0]).toBe(uuid(10));
    expect(planStorefront(rows, query({ orden: 'nombre' })).featuredIds).toEqual([]);
  });
});

describe('primo giorno ordinabile', () => {
  const monday: CalendarDate = { year: 2026, month: 11, day: 23 };

  it('oggi più l’anticipo, saltando i giorni chiusi', () => {
    expect(firstOrderableDate(monday, { minLeadDays: 1, closedWeekdays: [] })).toEqual({
      year: 2026,
      month: 11,
      day: 24,
    });
    // Martedì e mercoledì chiusi: giovedì.
    expect(firstOrderableDate(monday, { minLeadDays: 1, closedWeekdays: [2, 3] })).toEqual({
      year: 2026,
      month: 11,
      day: 26,
    });
    expect(firstOrderableDate(monday, { minLeadDays: 0, closedWeekdays: [] })).toEqual(monday);
  });

  it('tutti i giorni chiusi: nessun giorno', () => {
    expect(
      firstOrderableDate(monday, { minLeadDays: 0, closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }),
    ).toBeNull();
  });

  it('il giorno trovato è sempre accettato dal modulo d’ordine', () => {
    for (let lead = 0; lead <= 14; lead += 1) {
      for (let mask = 0; mask < 127; mask += 7) {
        const closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((day) => mask & (1 << day));
        for (let shift = 0; shift < 7; shift += 1) {
          const today = addDays(monday, shift);
          const date = firstOrderableDate(today, { minLeadDays: lead, closedWeekdays });
          expect(date).not.toBeNull();
          expect(marketplaceDateProblem(date!, { today, minLeadDays: lead, closedWeekdays })).toBe(
            null,
          );
          // E il giorno prima no (o è prima dell'anticipo, o è chiuso).
          const before = addDays(date!, -1);
          const beforeProblem = marketplaceDateProblem(before, {
            today,
            minLeadDays: lead,
            closedWeekdays,
          });
          expect(beforeProblem !== null || closedWeekdays.includes(dayOfWeek(before))).toBe(true);
        }
      }
    }
  });
});

describe('costo di consegna in una riga', () => {
  it('fisso, da-a con le fasce, o da confermare; mai «gratis»', () => {
    expect(deliveryFeeSummary({ defaultFeeMinor: 8000, tierFeesMinor: [] })).toEqual({
      kind: 'fixed',
      feeMinor: 8000,
    });
    expect(deliveryFeeSummary({ defaultFeeMinor: 0, tierFeesMinor: [] })).toEqual({
      kind: 'to_confirm',
    });
    expect(deliveryFeeSummary({ defaultFeeMinor: 0, tierFeesMinor: [6000, 9000, 12000] })).toEqual({
      kind: 'range',
      minMinor: 6000,
      maxMinor: 12000,
    });
    expect(deliveryFeeSummary({ defaultFeeMinor: 0, tierFeesMinor: [7000, 7000] })).toEqual({
      kind: 'fixed',
      feeMinor: 7000,
    });
    expect(deliveryFeeSummary({ defaultFeeMinor: 5000, tierFeesMinor: [0, 0] })).toEqual({
      kind: 'to_confirm',
    });
    expect(deliveryFeeSummary({ defaultFeeMinor: 0, tierFeesMinor: [0, 9000] })).toEqual({
      kind: 'range',
      minMinor: 0,
      maxMinor: 9000,
    });
  });
});

describe('carrello', () => {
  it('il cookie rovinato non è un errore: si tiene quello che vale', () => {
    expect(parseCart(undefined)).toEqual([]);
    expect(parseCart('v2.' + uuid(1) + '~1')).toEqual([]);
    expect(
      parseCart(
        [
          'v1',
          `${uuid(1)}~2`,
          'rotto',
          `${uuid(1)}~5`,
          `${uuid(2)}~0`,
          `${uuid(3)}~999`,
          `x~1`,
        ].join('.'),
      ),
    ).toEqual([
      { itemId: uuid(1), quantity: 2 },
      { itemId: uuid(3), quantity: MARKETPLACE_ORDER_LIMITS.quantityMax },
    ]);
    const many = ['v1', ...Array.from({ length: 25 }, (_, index) => `${uuid(index + 1)}~1`)].join(
      '.',
    );
    expect(parseCart(many)).toHaveLength(MARKETPLACE_ORDER_LIMITS.lines);
  });

  it('andata e ritorno; carrello vuoto = cookie vuoto', () => {
    const lines = [
      { itemId: uuid(1), quantity: 2 },
      { itemId: uuid(2), quantity: 1 },
    ];
    expect(parseCart(serializeCart(lines))).toEqual(lines);
    expect(serializeCart([])).toBe('');
  });

  it('aggiungere, cambiare, togliere; il 21° prodotto non entra', () => {
    let lines = addToCart([], uuid(1)).lines;
    lines = addToCart(lines, uuid(1), 2).lines;
    expect(lines).toEqual([{ itemId: uuid(1), quantity: 3 }]);
    expect(setCartLine(lines, uuid(1), 80).lines).toEqual([{ itemId: uuid(1), quantity: 50 }]);
    expect(setCartLine(lines, uuid(1), 0).lines).toEqual([]);
    const full = Array.from({ length: 20 }, (_, index) => ({
      itemId: uuid(index + 1),
      quantity: 1,
    }));
    const added = addToCart(full, uuid(99));
    expect(added.full).toBe(true);
    expect(added.lines).toHaveLength(20);
    // Uno già dentro si può sempre cambiare.
    expect(addToCart(full, uuid(1)).full).toBe(false);
  });
});

describe('ordine delle foto', () => {
  const order = ['a', 'b', 'c'];

  it('copertina, prima e dopo; ai bordi resta com’è', () => {
    expect(movePhotoId(order, 'c', 'first')).toEqual(['c', 'a', 'b']);
    expect(movePhotoId(order, 'b', 'earlier')).toEqual(['b', 'a', 'c']);
    expect(movePhotoId(order, 'b', 'later')).toEqual(['a', 'c', 'b']);
    expect(movePhotoId(order, 'a', 'earlier')).toEqual(order);
    expect(movePhotoId(order, 'c', 'later')).toEqual(order);
    expect(movePhotoId(order, 'z', 'first')).toBeNull();
  });
});

describe('politiche della fioreria', () => {
  it('facoltative, fino a 1000 caratteri', () => {
    expect(
      storePoliciesSchema.parse({
        policyChanges: '  ',
        policyCancellations: 'Hasta 24 horas antes.',
        policySubstitutions: '',
      }),
    ).toEqual({
      policyChanges: null,
      policyCancellations: 'Hasta 24 horas antes.',
      policySubstitutions: null,
    });
    expect(
      storePoliciesSchema.safeParse({ policyChanges: 'x'.repeat(STORE_LIMITS.policy + 1) }).success,
    ).toBe(false);
  });
});
