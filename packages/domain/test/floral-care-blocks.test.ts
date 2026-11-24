import { describe, expect, it } from 'vitest';
import {
  CARE_BLOCK_LIMITS,
  careBlockConfirmSchema,
  careBlockCovers,
  careBlockPlanFingerprint,
  careBlockSchema,
  careReassignSchema,
  parseIsoDate,
  pickCareSlotInMonth,
  toFieldErrors,
  upcomingCarePeakDays,
  type CalendarDate,
  type CareMonthCandidate,
} from '../src/index';

/**
 * Floral Care, blocco 4 (ADR-083): giorni bloccati, dove va una visita di un giorno bloccato,
 * impronta del piano, giorni di punta proposti.
 */

function d(iso: string): CalendarDate {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(iso);
  return date;
}

const SLOT_A = '01a20c3a-0000-7000-8000-00000000000a';
const SLOT_B = '01a20c3a-0000-7000-8000-00000000000b';

function errors(result: { success: boolean; error?: unknown }) {
  if (result.success) return {};
  return toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
}

describe('blocchi: modulo', () => {
  it('dal–al, tutto il giorno o un orario, nome; «Mover» se non si sceglie', () => {
    const parsed = careBlockSchema.parse({
      startDate: '2026-12-21',
      endDate: '2027-01-03',
      slotId: '',
      label: ' Vacaciones ',
      action: '',
    });
    expect(parsed).toEqual({
      startDate: d('2026-12-21'),
      endDate: d('2027-01-03'),
      slotId: null,
      label: 'Vacaciones',
      action: 'MOVE',
    });
    expect(
      careBlockSchema.parse({
        startDate: '2026-12-12',
        endDate: '2026-12-12',
        slotId: SLOT_A,
        label: 'Guadalupe',
        action: 'CANCEL',
      }),
    ).toMatchObject({ slotId: SLOT_A, action: 'CANCEL' });
  });

  it('la fine non va prima dell’inizio, al massimo 92 giorni, il nome serve', () => {
    expect(
      errors(
        careBlockSchema.safeParse({
          startDate: '2026-12-10',
          endDate: '2026-12-09',
          label: 'x',
        }),
      ),
    ).toEqual({ endDate: 'care_block_range' });
    expect(
      errors(
        careBlockSchema.safeParse({
          startDate: '2026-12-01',
          endDate: '2027-03-03',
          label: 'Temporada',
        }),
      ),
    ).toEqual({ endDate: 'care_block_too_long' });
    // 92 giorni esatti vanno bene.
    expect(
      careBlockSchema.safeParse({
        startDate: '2026-12-01',
        endDate: '2027-03-02',
        label: 'Temporada',
      }).success,
    ).toBe(true);
    expect(CARE_BLOCK_LIMITS.maxDays).toBe(92);
    expect(
      errors(careBlockSchema.safeParse({ startDate: '2026-12-01', endDate: '2026-12-01' })),
    ).toEqual({ label: 'required' });
    expect(
      errors(
        careBlockSchema.safeParse({
          startDate: '2026-12-01',
          endDate: '2026-12-01',
          label: 'x',
          action: 'DELETE',
        }),
      ),
    ).toEqual({ action: 'invalid_option' });
  });

  it('il salvataggio porta l’impronta, l’email facoltativa e la casella dell’avviso', () => {
    expect(
      careBlockConfirmSchema.parse({
        startDate: '2026-12-01',
        endDate: '2026-12-01',
        label: 'x',
        plan: '2-abc',
        sendEmail: 'on',
        customerNotified: 'on',
      }),
    ).toMatchObject({ plan: '2-abc', sendEmail: true, customerNotified: true });
  });

  it('cambio di persona: da chi a chi (anche a nessuno), mai la stessa', () => {
    const base = { startDate: '2026-12-01', endDate: '2026-12-05' };
    expect(
      careReassignSchema.parse({ ...base, fromMembershipId: SLOT_A, toMembershipId: '' }),
    ).toMatchObject({ fromMembershipId: SLOT_A, toMembershipId: null });
    expect(
      errors(
        careReassignSchema.safeParse({ ...base, fromMembershipId: SLOT_A, toMembershipId: SLOT_A }),
      ),
    ).toEqual({ toMembershipId: 'care_reassign_same' });
    expect(errors(careReassignSchema.safeParse({ ...base, fromMembershipId: '' }))).toEqual({
      fromMembershipId: 'required',
    });
  });
});

describe('blocchi: quali visite toccano', () => {
  const day = { startDate: d('2026-12-10'), endDate: d('2026-12-12'), slotId: null };
  const morning = { ...day, slotId: SLOT_A };

  it('tutto il giorno: ogni fascia e le ore libere, solo dentro le date', () => {
    expect(careBlockCovers(day, d('2026-12-10'), SLOT_A)).toBe(true);
    expect(careBlockCovers(day, d('2026-12-12'), null)).toBe(true);
    expect(careBlockCovers(day, d('2026-12-09'), SLOT_A)).toBe(false);
    expect(careBlockCovers(day, d('2026-12-13'), SLOT_A)).toBe(false);
  });

  it('un orario: solo quella fascia, mai le ore libere', () => {
    expect(careBlockCovers(morning, d('2026-12-11'), SLOT_A)).toBe(true);
    expect(careBlockCovers(morning, d('2026-12-11'), SLOT_B)).toBe(false);
    expect(careBlockCovers(morning, d('2026-12-11'), null)).toBe(false);
  });
});

describe('blocchi: dove va una visita di un giorno bloccato', () => {
  const candidate = (iso: string, slotId: string, free: number, startMinutes = 540) =>
    ({ date: d(iso), slotId, free, startMinutes }) satisfies CareMonthCandidate;

  it('prima un’altra fascia lo stesso giorno, poi il giorno più vicino del mese', () => {
    const picked = pickCareSlotInMonth({
      date: d('2026-12-10'),
      preferredSlotId: SLOT_A,
      seats: 1,
      candidates: [
        candidate('2026-12-10', SLOT_A, 0),
        candidate('2026-12-10', SLOT_B, 1, 900),
        candidate('2026-12-11', SLOT_A, 2),
      ],
    });
    expect(picked).toMatchObject({ slotId: SLOT_B });
  });

  it('a pari distanza il giorno prima; la sua fascia prima di un’altra', () => {
    const picked = pickCareSlotInMonth({
      date: d('2026-12-10'),
      preferredSlotId: SLOT_A,
      seats: 1,
      candidates: [
        candidate('2026-12-13', SLOT_A, 1),
        candidate('2026-12-07', SLOT_B, 1, 480),
        candidate('2026-12-07', SLOT_A, 1, 540),
      ],
    });
    expect(picked).toMatchObject({ date: d('2026-12-07'), slotId: SLOT_A });
  });

  it('cerca anche oltre la settimana, mai fuori dal mese e mai senza posti', () => {
    const picked = pickCareSlotInMonth({
      date: d('2026-12-29'),
      preferredSlotId: SLOT_A,
      seats: 2,
      candidates: [
        candidate('2027-01-02', SLOT_A, 5),
        candidate('2026-12-30', SLOT_A, 1),
        candidate('2026-12-15', SLOT_A, 2),
      ],
    });
    expect(picked).toMatchObject({ date: d('2026-12-15') });
    expect(
      pickCareSlotInMonth({
        date: d('2026-12-29'),
        preferredSlotId: SLOT_A,
        seats: 1,
        candidates: [candidate('2027-01-02', SLOT_A, 5)],
      }),
    ).toBeNull();
  });
});

describe('blocchi: impronta del piano', () => {
  const a = { visitId: 'a', outcome: 'MOVED' as const, toDate: '2026-12-11', toSlotId: SLOT_A };
  const b = { visitId: 'b', outcome: 'TO_RESCHEDULE' as const, toDate: null, toSlotId: null };

  it('la stessa in qualsiasi ordine, diversa se cambia un posto', () => {
    expect(careBlockPlanFingerprint([a, b])).toBe(careBlockPlanFingerprint([b, a]));
    expect(careBlockPlanFingerprint([a, b])).not.toBe(
      careBlockPlanFingerprint([{ ...a, toDate: '2026-12-14' }, b]),
    );
    expect(careBlockPlanFingerprint([a])).not.toBe(careBlockPlanFingerprint([a, b]));
    expect(careBlockPlanFingerprint([])).toMatch(/^0-[0-9a-f]{16}$/);
  });
});

describe('blocchi: giorni di punta proposti', () => {
  it('in Messico la prossima volta di ognuno, in ordine', () => {
    const peaks = upcomingCarePeakDays('MX', d('2026-11-24'));
    expect(peaks.map((peak) => [peak.key, peak.startDate, peak.endDate])).toEqual([
      ['guadalupe', d('2026-12-12'), d('2026-12-12')],
      ['valentine', d('2027-02-14'), d('2027-02-14')],
      ['mothers', d('2027-05-10'), d('2027-05-10')],
      ['deadDays', d('2027-11-01'), d('2027-11-02')],
    ]);
  });

  it('un giorno di punta già cominciato vale da oggi alla fine', () => {
    const peaks = upcomingCarePeakDays('MX', d('2026-11-02'));
    expect(peaks[0]).toEqual({
      key: 'deadDays',
      startDate: d('2026-11-02'),
      endDate: d('2026-11-02'),
    });
  });

  it('per un mercato senza giorni scritti, nessuna proposta', () => {
    expect(upcomingCarePeakDays('IT', d('2026-11-24'))).toEqual([]);
  });
});
