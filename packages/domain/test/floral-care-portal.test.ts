import { describe, expect, it } from 'vitest';
import {
  CARE_PORTAL_LIMITS,
  careCustomerChangeProblem,
  careCustomerChangeUntil,
  careCustomerEarliestStart,
  careCustomerTargetProblem,
  careMonthBounds,
  carePortalContractState,
  carePortalInviteExpiresAt,
  carePortalInviteSchema,
  carePortalInviteStatus,
  carePortalMoveSchema,
  carePhotoPurgeDate,
  parseIsoDate,
  toFieldErrors,
  type CalendarDate,
} from '../src/index';

/**
 * Floral Care, blocco 5a (ADR-084): la pagina del cliente. Invito, contratto visibile o in sola
 * lettura, "Cambiar fecha" con il preavviso e lo stesso mese.
 */

function d(iso: string): CalendarDate {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(iso);
  return date;
}

const MX = 'America/Mexico_City';
const SLOT_A = '11111111-1111-4111-8111-111111111111';
const SLOT_B = '22222222-2222-4222-8222-222222222222';

describe('invito al portale', () => {
  it('normalizza l’email, vale "Solo este contrato" e la casella dei soldi', () => {
    const parsed = carePortalInviteSchema.parse({
      email: '  Ana.Lopez@Example.COM ',
      scope: '',
      canSeeMoney: 'on',
    });
    expect(parsed).toEqual({
      email: 'ana.lopez@example.com',
      scope: 'CONTRACT',
      canSeeMoney: true,
    });
    expect(carePortalInviteSchema.parse({ email: 'a@b.mx', scope: 'CUSTOMER' }).canSeeMoney).toBe(
      false,
    );
  });

  it('rifiuta email vuote o non valide e ambiti sconosciuti', () => {
    const empty = carePortalInviteSchema.safeParse({ email: '', scope: 'CONTRACT' });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(toFieldErrors(empty.error)).toMatchObject({ email: 'required' });
    const wrong = carePortalInviteSchema.safeParse({ email: 'nope', scope: 'ALL' });
    expect(wrong.success).toBe(false);
    if (!wrong.success) {
      expect(toFieldErrors(wrong.error)).toMatchObject({
        email: 'invalid_email',
        scope: 'invalid_option',
      });
    }
  });

  it('scade dopo 7 giorni, anche prima che passi il lavoro giornaliero', () => {
    const now = new Date('2026-11-25T15:00:00Z');
    const expiresAt = carePortalInviteExpiresAt(now);
    expect(expiresAt.toISOString()).toBe('2026-12-02T15:00:00.000Z');
    expect(CARE_PORTAL_LIMITS.inviteDays).toBe(7);
    expect(carePortalInviteStatus({ status: 'PENDING', expiresAt }, now)).toBe('PENDING');
    expect(carePortalInviteStatus({ status: 'PENDING', expiresAt }, expiresAt)).toBe('EXPIRED');
    expect(carePortalInviteStatus({ status: 'ACCEPTED', expiresAt }, expiresAt)).toBe('ACCEPTED');
    expect(carePortalInviteStatus({ status: 'REVOKED', expiresAt }, now)).toBe('REVOKED');
  });
});

describe('il contratto nella pagina del cliente', () => {
  it('attivo o in pausa è aperto; borrador e scartato no', () => {
    const today = d('2026-11-25');
    expect(carePortalContractState({ status: 'ACTIVE', endDate: null, today })).toBe('OPEN');
    expect(carePortalContractState({ status: 'PAUSED', endDate: null, today })).toBe('OPEN');
    expect(carePortalContractState({ status: 'DRAFT', endDate: null, today })).toBe('CLOSED');
    expect(carePortalContractState({ status: 'CANCELLED', endDate: null, today })).toBe('CLOSED');
  });

  it('finito resta in sola lettura fino al giorno in cui si cancellano le foto', () => {
    const endDate = d('2026-11-10');
    const purge = carePhotoPurgeDate(endDate);
    expect(purge).toEqual(d('2026-12-10'));
    expect(carePortalContractState({ status: 'ENDED', endDate, today: d('2026-11-10') })).toBe(
      'READ_ONLY',
    );
    expect(carePortalContractState({ status: 'ENDED', endDate, today: d('2026-12-09') })).toBe(
      'READ_ONLY',
    );
    expect(carePortalContractState({ status: 'ENDED', endDate, today: purge })).toBe('CLOSED');
    expect(carePortalContractState({ status: 'ENDED', endDate: null, today: purge })).toBe(
      'CLOSED',
    );
  });
});

describe('"Cambiar fecha"', () => {
  const visit = {
    status: 'SCHEDULED' as const,
    isExtra: false,
    scheduledDate: d('2026-11-27'),
    startMinutes: 9 * 60,
    slotId: SLOT_A,
  };

  it('il termine è l’inizio della visita meno le ore del contratto, nell’ora della fioreria', () => {
    // 27/11 alle 9:00 a Città del Messico = 15:00 UTC; 24 ore prima: 26/11 alle 15:00 UTC.
    const start = new Date('2026-11-27T15:00:00Z');
    expect(careCustomerChangeUntil(start, 24)?.toISOString()).toBe('2026-11-26T15:00:00.000Z');
    expect(careCustomerChangeUntil(start, 0)?.toISOString()).toBe(start.toISOString());
    expect(careCustomerChangeUntil(null, 24)).toBeNull();
    expect(careCustomerEarliestStart(start, 2).toISOString()).toBe('2026-11-27T17:00:00.000Z');
  });

  it('con l’ora legale di Roma il termine segue l’ora locale', () => {
    // 26/10/2026 alle 9:00 a Roma è già ora solare (UTC+1): 8:00 UTC; 24 ore prima, 25/10 8:00 UTC.
    const problem = careCustomerChangeProblem({
      contractStatus: 'ACTIVE',
      visit: { ...visit, scheduledDate: d('2026-10-26') },
      noticeHours: 24,
      timeZone: 'Europe/Rome',
      now: new Date('2026-10-25T07:59:00Z'),
    });
    expect(problem).toBeNull();
    expect(
      careCustomerChangeProblem({
        contractStatus: 'ACTIVE',
        visit: { ...visit, scheduledDate: d('2026-10-26') },
        noticeHours: 24,
        timeZone: 'Europe/Rome',
        now: new Date('2026-10-25T08:01:00Z'),
      }),
    ).toBe('care_portal_move_notice');
  });

  it('solo visite regolari programmate di un contratto attivo, prima del termine', () => {
    const base = { noticeHours: 24, timeZone: MX, now: new Date('2026-11-25T15:00:00Z') };
    expect(careCustomerChangeProblem({ ...base, contractStatus: 'ACTIVE', visit })).toBeNull();
    expect(careCustomerChangeProblem({ ...base, contractStatus: 'ENDED', visit })).toBe(
      'care_portal_contract_not_open',
    );
    for (const changed of [
      { ...visit, isExtra: true },
      { ...visit, status: 'TO_RESCHEDULE' as const },
      { ...visit, status: 'DONE' as const },
      { ...visit, scheduledDate: null },
      { ...visit, slotId: null },
    ]) {
      expect(careCustomerChangeProblem({ ...base, contractStatus: 'ACTIVE', visit: changed })).toBe(
        'care_portal_move_not_allowed',
      );
    }
    expect(
      careCustomerChangeProblem({
        ...base,
        contractStatus: 'ACTIVE',
        visit,
        now: new Date('2026-11-26T15:01:00Z'),
      }),
    ).toBe('care_portal_move_notice');
  });

  it('il nuovo posto: stesso mese, dentro il contratto, dopo il preavviso, non lo stesso', () => {
    const base = {
      current: { date: d('2026-11-27'), slotId: SLOT_A },
      contract: { startDate: d('2026-11-01'), endDate: d('2026-11-28') },
      noticeHours: 24,
      timeZone: MX,
      now: new Date('2026-11-25T15:00:00Z'),
    };
    const at = (iso: string, slotId = SLOT_B, startMinutes = 10 * 60) => ({
      date: d(iso),
      slotId,
      startMinutes,
    });
    expect(careCustomerTargetProblem({ ...base, target: at('2026-11-27') })).toBeNull();
    expect(careCustomerTargetProblem({ ...base, target: at('2026-12-01') })).toBe(
      'care_portal_move_other_month',
    );
    expect(careCustomerTargetProblem({ ...base, target: at('2026-11-30') })).toBe(
      'care_move_out_of_range',
    );
    expect(careCustomerTargetProblem({ ...base, target: at('2026-11-27', SLOT_A, 9 * 60) })).toBe(
      'care_portal_move_same',
    );
    // Il 26/11 alle 10:00 è meno di 24 ore da adesso (25/11 9:00 a Città del Messico).
    expect(careCustomerTargetProblem({ ...base, target: at('2026-11-26', SLOT_B, 8 * 60) })).toBe(
      'care_portal_move_notice',
    );
    expect(
      careCustomerTargetProblem({ ...base, target: at('2026-11-26', SLOT_B, 10 * 60) }),
    ).toBeNull();
  });

  it('i giorni del mese e il modulo', () => {
    expect(careMonthBounds(d('2028-02-15'))).toEqual({
      from: d('2028-02-01'),
      until: d('2028-02-29'),
    });
    expect(carePortalMoveSchema.parse({ date: '2026-11-27', slotId: SLOT_A })).toEqual({
      date: d('2026-11-27'),
      slotId: SLOT_A,
    });
    const bad = carePortalMoveSchema.safeParse({ date: '27/11', slotId: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(toFieldErrors(bad.error)).toMatchObject({ date: 'invalid_date', slotId: 'required' });
    }
  });
});
