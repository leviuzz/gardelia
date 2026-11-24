import { describe, expect, it } from 'vitest';
import {
  careExtraFeeMinor,
  careExtraVisitSchema,
  careFinishSchema,
  careFollowUpResolutions,
  careFollowUpResolveSchema,
  carePlantSchema,
  careQuoteSchema,
  careVisitMoveSchema,
  suggestedCareExtraFee,
  suggestedCareReplacement,
  toFieldErrors,
} from '../src/index';

const SLOT = '0190a1b2-0000-7000-8000-000000000011';
const QUOTE = '0190a1b2-0000-7000-8000-000000000012';
const FOLLOW_UP = '0190a1b2-0000-7000-8000-000000000013';

function errors(result: { success: boolean; error?: unknown }) {
  if (result.success) return {};
  return toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
}

describe('visita extra: il modulo', () => {
  it('in un orario serve la fascia; il posto arriva senza i campi dell’ora libera', () => {
    expect(
      errors(
        careExtraVisitSchema.safeParse({
          kind: 'EXTRA',
          placement: 'SLOT',
          date: '2026-12-02',
          fee: 'VISIT_FEE',
        }),
      ),
    ).toMatchObject({ slotId: 'required' });
    const parsed = careExtraVisitSchema.parse({
      kind: 'REPLACEMENT',
      placement: 'SLOT',
      date: '2026-12-02',
      slotId: SLOT,
      start: '10:00',
      fee: 'FREE',
      quoteId: QUOTE,
      followUpId: FOLLOW_UP,
    });
    expect(parsed.placement).toEqual({
      placement: 'SLOT',
      date: { year: 2026, month: 12, day: 2 },
      slotId: SLOT,
    });
    // "Sin costo" non porta una cotización.
    expect(parsed.quoteId).toBeNull();
    expect(parsed.followUpId).toBe(FOLLOW_UP);
  });

  it('a un’ora libera servono inizio e fine, nell’ordine', () => {
    expect(
      errors(
        careExtraVisitSchema.safeParse({
          kind: 'EXTRA',
          placement: 'TIME',
          date: '2026-12-02',
          fee: 'VISIT_FEE',
        }),
      ),
    ).toMatchObject({ start: 'required', end: 'required' });
    expect(
      errors(
        careExtraVisitSchema.safeParse({
          kind: 'EXTRA',
          placement: 'TIME',
          date: '2026-12-02',
          start: '17:00',
          end: '16:00',
          fee: 'VISIT_FEE',
        }),
      ),
    ).toMatchObject({ end: 'invalid_time_window' });
    expect(
      careExtraVisitSchema.parse({
        kind: 'SEASONAL_INSTALL',
        placement: 'TIME',
        date: '2026-12-02',
        start: '16:30',
        end: '18:00',
        fee: 'QUOTE',
        quoteId: QUOTE,
      }).placement,
    ).toEqual({
      placement: 'TIME',
      date: { year: 2026, month: 12, day: 2 },
      startMinutes: 990,
      endMinutes: 1080,
    });
  });

  it('"en la cotización" vuole la cotización; tipo, costo e nota si controllano', () => {
    expect(
      errors(
        careExtraVisitSchema.safeParse({
          kind: 'SEASONAL_PICKUP',
          placement: 'SLOT',
          date: '2026-12-02',
          slotId: SLOT,
          fee: 'QUOTE',
        }),
      ),
    ).toMatchObject({ quoteId: 'required' });
    expect(
      errors(
        careExtraVisitSchema.safeParse({
          kind: 'PARTY',
          placement: 'SLOT',
          date: 'mañana',
          slotId: SLOT,
          fee: 'GRATIS',
          note: 'x'.repeat(201),
        }),
      ),
    ).toMatchObject({
      kind: 'required',
      date: 'invalid_date',
      fee: 'required',
      note: 'too_long',
    });
  });
});

describe('spostare una visita', () => {
  it('senza scelta vale l’orario di visita, come nel blocco 1', () => {
    expect(
      careVisitMoveSchema.parse({ date: '2026-12-03', slotId: SLOT, customerNotified: 'on' }),
    ).toEqual({
      placement: 'SLOT',
      date: { year: 2026, month: 12, day: 3 },
      slotId: SLOT,
      customerNotified: true,
    });
    expect(errors(careVisitMoveSchema.safeParse({ date: '2026-12-03' }))).toMatchObject({
      slotId: 'required',
    });
  });

  it('a un’ora libera (solo le extra, lo controlla il server)', () => {
    expect(
      careVisitMoveSchema.parse({
        placement: 'TIME',
        date: '2026-12-03',
        start: '08:00',
        end: '09:15',
      }),
    ).toEqual({
      placement: 'TIME',
      date: { year: 2026, month: 12, day: 3 },
      startMinutes: 480,
      endMinutes: 555,
      customerNotified: false,
    });
  });
});

describe('costo di una visita extra', () => {
  const contract = { visitFeeMinor: 45_000, travelSurchargeMinor: 8_000 };

  it('la tariffa per visita del contratto con il viaggio, oppure niente', () => {
    expect(careExtraFeeMinor('VISIT_FEE', contract)).toBe(53_000);
    expect(careExtraFeeMinor('FREE', contract)).toBe(0);
    // Dentro la cotización: si paga lì, non con il canone.
    expect(careExtraFeeMinor('QUOTE', contract)).toBe(0);
  });

  it('il costo proposto segue il tipo e la regola della fioreria', () => {
    expect(suggestedCareExtraFee('REPLACEMENT', 'INCLUDED', true)).toBe('FREE');
    expect(suggestedCareExtraFee('REPLACEMENT', 'QUOTE', true)).toBe('QUOTE');
    expect(suggestedCareExtraFee('REPLACEMENT', 'QUOTE', false)).toBe('VISIT_FEE');
    expect(suggestedCareExtraFee('SEASONAL_INSTALL', 'QUOTE', true)).toBe('QUOTE');
    expect(suggestedCareExtraFee('SEASONAL_PICKUP', 'INCLUDED', false)).toBe('VISIT_FEE');
    expect(suggestedCareExtraFee('EXTRA', 'INCLUDED', true)).toBe('VISIT_FEE');
  });
});

describe('avvisi: come si risolvono', () => {
  it('una pianta morta ha le sue scelte; la regola della fioreria ne suggerisce una', () => {
    expect(careFollowUpResolutions('REPLACEMENT')).toEqual([
      'FREE_VISIT',
      'NEXT_VISIT',
      'QUOTED',
      'NOT_REPLACED',
    ]);
    expect(careFollowUpResolutions('EXTRA')).toEqual(['HANDLED', 'QUOTED']);
    expect(careFollowUpResolutions('OTHER')).toEqual(['HANDLED', 'QUOTED']);
    expect(suggestedCareReplacement('INCLUDED')).toBe('FREE_VISIT');
    expect(suggestedCareReplacement('QUOTE')).toBe('QUOTED');
  });

  it('a mano si segnano solo le scelte che non creano una visita o una cotización', () => {
    expect(careFollowUpResolveSchema.parse({ resolution: 'NEXT_VISIT', note: ' ' })).toEqual({
      resolution: 'NEXT_VISIT',
      note: null,
    });
    expect(errors(careFollowUpResolveSchema.safeParse({ resolution: 'FREE_VISIT' }))).toEqual({
      resolution: 'required',
    });
    expect(errors(careFollowUpResolveSchema.safeParse({ resolution: 'QUOTED' }))).toEqual({
      resolution: 'required',
    });
  });

  it('"Cotizar" dice per cosa', () => {
    expect(careQuoteSchema.parse({ purpose: 'SEASONAL' })).toEqual({
      purpose: 'SEASONAL',
      followUpId: null,
    });
    expect(errors(careQuoteSchema.safeParse({ purpose: 'BODA' }))).toEqual({
      purpose: 'required',
    });
  });
});

describe('cambio di stagione', () => {
  it('una pianta di temporada si segna con la casella; al ritiro si archiviano con la casella', () => {
    const base = { name: 'Nochebuena', quantity: '6', size: 'SMALL' };
    expect(carePlantSchema.parse({ ...base, seasonal: 'on' }).seasonal).toBe(true);
    expect(carePlantSchema.parse(base).seasonal).toBe(false);
    expect(careFinishSchema.parse({ archiveSeasonal: 'on' }).archiveSeasonal).toBe(true);
    expect(careFinishSchema.parse({}).archiveSeasonal).toBe(false);
  });
});
