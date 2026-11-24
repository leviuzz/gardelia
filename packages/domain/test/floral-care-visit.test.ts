import { describe, expect, it } from 'vitest';
import {
  CARE_VISIT_LIMITS,
  canShareCareVisit,
  canStartCareVisit,
  canWorkOnCareVisit,
  careChecklist,
  careEmailsAllowed,
  careFinishSchema,
  careFollowUpSchema,
  careMaterialSchema,
  careNotDoneSchema,
  carePhotoPurgeDate,
  carePhotoUploadSchema,
  carePlantResultSchema,
  carePlantTally,
  careReportRecipient,
  careServiceResultSchema,
  isCarePhotoPurgeDue,
  isCarePhotoPurgeOverdue,
  toFieldErrors,
  toIsoDate,
  type CalendarDate,
} from '../src/index';

const day = (iso: string): CalendarDate => {
  const [year, month, dayOfMonth] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: dayOfMonth! };
};

const PLANT = '0190a1b2-0000-7000-8000-000000000001';
const SERVICE = '0190a1b2-0000-7000-8000-000000000002';

describe('stati della visita dal telefono', () => {
  it('si inizia una programmata, si lavora in corso, si condivide una chiusa', () => {
    expect(canStartCareVisit('SCHEDULED')).toBe(true);
    expect(canStartCareVisit('IN_PROGRESS')).toBe(false);
    expect(canStartCareVisit('TO_RESCHEDULE')).toBe(false);
    expect(canWorkOnCareVisit('IN_PROGRESS')).toBe(true);
    expect(canWorkOnCareVisit('SCHEDULED')).toBe(false);
    expect(canWorkOnCareVisit('DONE')).toBe(false);
    expect(canShareCareVisit('DONE')).toBe(true);
    expect(canShareCareVisit('NOT_DONE')).toBe(true);
    expect(canShareCareVisit('IN_PROGRESS')).toBe(false);
    expect(canShareCareVisit('CANCELLED')).toBe(false);
  });
});

describe('email di Floral Care', () => {
  it('solo una fioreria LIVE e attiva scrive ai clienti', () => {
    expect(careEmailsAllowed({ mode: 'LIVE', status: 'ACTIVE' })).toBe(true);
    expect(careEmailsAllowed({ mode: 'DEMO', status: 'ACTIVE' })).toBe(false);
    expect(careEmailsAllowed({ mode: 'LIVE', status: 'SUSPENDED' })).toBe(false);
    expect(careEmailsAllowed({ mode: 'LIVE', status: 'ARCHIVED' })).toBe(false);
  });

  it('il resoconto va al cliente solo se chiesto, permesso e con email', () => {
    const base = { requested: true, allowed: true, customerEmail: ' ana@example.com ' };
    expect(careReportRecipient(base)).toBe('ana@example.com');
    expect(careReportRecipient({ ...base, requested: false })).toBeNull();
    expect(careReportRecipient({ ...base, allowed: false })).toBeNull();
    expect(careReportRecipient({ ...base, customerEmail: '  ' })).toBeNull();
    expect(careReportRecipient({ ...base, customerEmail: null })).toBeNull();
  });
});

describe('checklist', () => {
  it('un servizio "una sola vez" già fatto non ricompare; gli altri sì', () => {
    const services = [
      { serviceId: 'a', unit: 'PER_VISIT' as const },
      { serviceId: 'b', unit: 'ONE_TIME' as const },
      { serviceId: 'c', unit: 'ONE_TIME' as const },
      { serviceId: 'd', unit: 'PER_PLANT' as const },
    ];
    expect(careChecklist(services, new Set(['b', 'a'])).map((s) => s.serviceId)).toEqual([
      'a',
      'c',
      'd',
    ]);
    expect(careChecklist(services, new Set()).map((s) => s.serviceId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});

describe('conteggio delle piante', () => {
  it('un gruppo con un problema conta solo le piante toccate; le altre stanno bene', () => {
    const tally = carePlantTally([
      { quantity: 12, condition: 'PROBLEM', affected: 2 },
      { quantity: 3, condition: 'OK', affected: null },
      { quantity: 1, condition: 'DEAD', affected: null },
      { quantity: 4, condition: 'ATTENTION', affected: 9 },
      { quantity: 5, condition: null, affected: null },
    ]);
    expect(tally).toEqual({ total: 25, ok: 13, attention: 4, problem: 2, dead: 1, unmarked: 5 });
  });

  it('nessuna pianta: tutto a zero', () => {
    expect(carePlantTally([])).toEqual({
      total: 0,
      ok: 0,
      attention: 0,
      problem: 0,
      dead: 0,
      unmarked: 0,
    });
  });
});

describe('cancellazione delle foto', () => {
  it('30 giorni dopo l’ultimo giorno del contratto, anche a cavallo di mese, anno e bisestile', () => {
    expect(toIsoDate(carePhotoPurgeDate(day('2026-11-24')))).toBe('2026-12-24');
    expect(toIsoDate(carePhotoPurgeDate(day('2026-12-15')))).toBe('2027-01-14');
    expect(toIsoDate(carePhotoPurgeDate(day('2028-02-10')))).toBe('2028-03-11');
    expect(toIsoDate(carePhotoPurgeDate(day('2027-02-10')))).toBe('2027-03-12');
  });

  it('dovuta dal 30° giorno; in ritardo (errore nel log) dal 37°', () => {
    const end = day('2026-11-24');
    expect(isCarePhotoPurgeDue(end, day('2026-12-23'))).toBe(false);
    expect(isCarePhotoPurgeDue(end, day('2026-12-24'))).toBe(true);
    expect(isCarePhotoPurgeOverdue(end, day('2026-12-30'))).toBe(false);
    expect(isCarePhotoPurgeOverdue(end, day('2026-12-31'))).toBe(true);
  });
});

describe('moduli dei passi', () => {
  it('servizio: fatto, non fatto o vuoto per togliere la scelta', () => {
    expect(careServiceResultSchema.parse({ serviceId: SERVICE, outcome: 'DONE' })).toEqual({
      serviceId: SERVICE,
      outcome: 'DONE',
      note: null,
    });
    expect(careServiceResultSchema.parse({ serviceId: SERVICE, outcome: '' }).outcome).toBeNull();
    const wrong = careServiceResultSchema.safeParse({ serviceId: 'x', outcome: 'MAYBE' });
    expect(wrong.success).toBe(false);
    if (!wrong.success) {
      expect(toFieldErrors(wrong.error)).toMatchObject({
        serviceId: 'required',
        outcome: 'invalid_option',
      });
    }
  });

  it('pianta: "Bien" non porta quante sono toccate; la nota ha un limite', () => {
    expect(
      carePlantResultSchema.parse({ plantId: PLANT, condition: 'OK', affected: '3' }).affected,
    ).toBeNull();
    expect(
      carePlantResultSchema.parse({ plantId: PLANT, condition: 'PROBLEM', affected: '3' }).affected,
    ).toBe(3);
    const long = carePlantResultSchema.safeParse({
      plantId: PLANT,
      condition: 'DEAD',
      note: 'x'.repeat(CARE_VISIT_LIMITS.resultNote + 1),
    });
    expect(long.success).toBe(false);
    if (!long.success) expect(toFieldErrors(long.error)).toMatchObject({ note: 'too_long' });
    const missing = carePlantResultSchema.safeParse({ plantId: PLANT, condition: '' });
    expect(missing.success).toBe(false);
  });

  it('materiale: 0 toglie la riga, oltre il massimo no', () => {
    expect(careMaterialSchema.parse({ catalogItemId: SERVICE, quantity: '0' }).quantity).toBe(0);
    expect(
      careMaterialSchema.safeParse({ catalogItemId: SERVICE, quantity: '100001' }).success,
    ).toBe(false);
  });

  it('avviso: il tipo e la nota sono obbligatori, la pianta no', () => {
    expect(careFollowUpSchema.parse({ kind: 'EXTRA', note: 'Evento el viernes' })).toEqual({
      kind: 'EXTRA',
      plantId: null,
      quantity: null,
      note: 'Evento el viernes',
    });
    const empty = careFollowUpSchema.safeParse({ kind: 'OTHER', note: ' ' });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(toFieldErrors(empty.error)).toMatchObject({ note: 'required' });
  });

  it('foto: serve la chiave del caricamento', () => {
    expect(carePhotoUploadSchema.parse({ uploadKey: PLANT, plantId: '' }).plantId).toBeNull();
    expect(carePhotoUploadSchema.safeParse({ uploadKey: '' }).success).toBe(false);
  });

  it('fine e "No se pudo": le caselle', () => {
    expect(careFinishSchema.parse({ sendReport: 'on' })).toEqual({
      sendReport: true,
      confirmShortage: false,
      archiveSeasonal: false,
    });
    expect(careNotDoneSchema.parse({ note: ' Cerrado ' })).toEqual({
      note: 'Cerrado',
      sendReport: false,
    });
  });
});
