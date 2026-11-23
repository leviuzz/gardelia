import { describe, expect, it } from 'vitest';
import {
  customerAddressSchema,
  customerCreateFormSchema,
  customerFormSchema,
  isPlatformSource,
  customerBulkTagSchema,
  customerListFiltersSchema,
  isValidMonthDay,
  nextOccurrence,
  normalizeTag,
  occasionSchema,
  upcomingMonthDays,
  whatsappLink,
} from '../src/customer';
import { toFieldErrors } from '../src/validation';

describe('form cliente', () => {
  const schema = customerFormSchema('MX');
  const valid = {
    type: 'PERSON',
    displayName: ' María Fernanda López ',
    legalName: '',
    taxId: '',
    email: 'MAFER@Example.test',
    phone: '449 555 0142',
    notes: '',
    preferences: 'Tonos pastel',
    restrictions: '',
    tags: 'frecuente, VIP',
    acquisitionChannel: 'instagram',
    marketingConsent: 'on',
  };

  it('normalizza contatti, etichette e consenso', () => {
    expect(schema.parse(valid)).toMatchObject({
      displayName: 'María Fernanda López',
      email: 'mafer@example.test',
      phone: '+524495550142',
      tags: ['frecuente', 'vip'],
      acquisitionChannel: 'instagram',
      marketingConsent: true,
      legalName: null,
    });
  });

  it('senza checkbox il consenso marketing è falso; canale vuoto → null', () => {
    const result = schema.parse({ ...valid, marketingConsent: undefined, acquisitionChannel: '' });
    expect(result.marketingConsent).toBe(false);
    expect(result.acquisitionChannel).toBeNull();
  });

  it('valida telefono, email, RFC e canale', () => {
    const result = schema.safeParse({
      ...valid,
      phone: '12',
      email: 'no-es-email',
      taxId: 'XYZ',
      acquisitionChannel: 'radio',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toMatchObject({
        phone: 'invalid_phone',
        email: 'invalid_email',
        taxId: 'invalid_tax_id',
        acquisitionChannel: 'invalid_option',
      });
    }
  });

  it('l’origine "piattaforma" non è un campo del form (nessuna fee manipolabile)', () => {
    const result = schema.parse({ ...valid, acquisitionSource: 'NETWORK_B2B' });
    expect(result).not.toHaveProperty('acquisitionSource');
    expect(isPlatformSource('NETWORK_B2B')).toBe(true);
    expect(isPlatformSource('MERCHANT_DIRECT')).toBe(false);
  });
});

describe('nuovo cliente con le sue date speciali', () => {
  const base = { type: 'PERSON', displayName: 'Ana Ruiz', marketingConsent: '' };

  it('le date arrivano come JSON e si validano una per una', () => {
    const parsed = customerCreateFormSchema('MX').parse({
      ...base,
      occasions: JSON.stringify([
        { type: 'BIRTHDAY', month: '5', day: '10', year: '1990' },
        { type: 'CUSTOM', label: 'Día de las madres', month: '5', day: '10', personName: 'Mamá' },
      ]),
    });
    expect(parsed.displayName).toBe('Ana Ruiz');
    expect(parsed.occasions).toHaveLength(2);
    expect(parsed.occasions[0]).toMatchObject({ type: 'BIRTHDAY', month: 5, day: 10, year: 1990 });
    expect(parsed.occasions[1]).toMatchObject({ label: 'Día de las madres', remindDaysBefore: 7 });
  });

  it('senza date va bene; gli errori indicano la data e il campo', () => {
    expect(customerCreateFormSchema('MX').parse({ ...base, occasions: '' }).occasions).toEqual([]);
    expect(customerCreateFormSchema('MX').parse(base).occasions).toEqual([]);
    const result = customerCreateFormSchema('MX').safeParse({
      ...base,
      displayName: '',
      occasions: JSON.stringify([
        { type: 'BIRTHDAY', month: '5', day: '10' },
        { type: 'CUSTOM', month: '2', day: '30' },
      ]),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toMatchObject({
        displayName: 'required',
        'occasions.1.day': 'invalid_date',
        'occasions.1.label': 'required',
      });
    }
  });

  it('JSON rovinato o troppe date: errore, niente dati a metà', () => {
    expect(customerCreateFormSchema('MX').safeParse({ ...base, occasions: '{' }).success).toBe(
      false,
    );
    const many = Array.from({ length: 31 }, () => ({ type: 'BIRTHDAY', month: '1', day: '1' }));
    const result = customerCreateFormSchema('MX').safeParse({
      ...base,
      occasions: JSON.stringify(many),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toMatchObject({ occasions: 'too_many_items' });
    }
  });
});

describe('indirizzi e ricorrenze', () => {
  it('valida un indirizzo messicano', () => {
    const result = customerAddressSchema('MX').safeParse({
      addressLine1: 'Calle Juárez 10',
      city: 'Aguascalientes',
      region: 'XX',
      postalCode: '200',
      recipientPhone: '449 555 0101',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toMatchObject({
        region: 'invalid_option',
        postalCode: 'invalid_postal_code',
      });
    }
  });

  it('rifiuta date impossibili e richiede un nome per le ricorrenze personalizzate', () => {
    expect(isValidMonthDay(2, 29)).toBe(true);
    expect(isValidMonthDay(2, 30)).toBe(false);
    expect(isValidMonthDay(4, 31)).toBe(false);
    const result = occasionSchema.safeParse({ type: 'CUSTOM', month: '2', day: '30' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toMatchObject({ day: 'invalid_date', label: 'required' });
    }
    expect(occasionSchema.parse({ type: 'BIRTHDAY', month: '5', day: '10' }).remindDaysBefore).toBe(
      7,
    );
  });

  it('calcola la prossima ricorrenza nel fuso del tenant', () => {
    // 21 nov 2026 03:00 UTC = 20 nov 21:00 a Città del Messico.
    const now = new Date(Date.UTC(2026, 10, 21, 3, 0));
    expect(nextOccurrence(11, 20, 'America/Mexico_City', now)).toEqual({
      year: 2026,
      month: 11,
      day: 20,
      daysUntil: 0,
    });
    // In UTC è già il 21: la ricorrenza del 20 cade l'anno prossimo.
    expect(nextOccurrence(11, 20, 'UTC', now).year).toBe(2027);
    expect(nextOccurrence(12, 25, 'America/Mexico_City', now).daysUntil).toBe(35);
  });

  it('il 29 febbraio negli anni non bisestili si ricorda il 28', () => {
    const now = new Date(Date.UTC(2026, 0, 10, 18, 0));
    expect(nextOccurrence(2, 29, 'America/Mexico_City', now)).toMatchObject({
      year: 2026,
      day: 28,
    });
  });

  it('genera link WhatsApp senza invii automatici', () => {
    expect(whatsappLink('+524495550142')).toBe('https://wa.me/524495550142');
    expect(whatsappLink('+524495550142', 'Hola, ¿cómo estás?')).toBe(
      'https://wa.me/524495550142?text=Hola%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F',
    );
  });
});

describe('etichette e filtri dei clienti (ADR-070)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it("un'etichetta si scrive come nella scheda del cliente", () => {
    expect(normalizeTag('  Cliente   VIP ')).toBe('cliente vip');
    expect(normalizeTag(42)).toBe('');
  });

  it('filtri della lista: etichetta, consenso e fecha especial próxima', () => {
    expect(
      customerListFiltersSchema.parse({ tag: ' Bodas ', consent: 'no', upcoming: '1' }),
    ).toMatchObject({ tag: 'bodas', consent: 'no', upcoming: true });
    // Valori sconosciuti: nessun filtro, mai un errore.
    expect(
      customerListFiltersSchema.parse({ tag: 'x'.repeat(31), consent: 'forse', upcoming: 'si' }),
    ).toMatchObject({ tag: '', consent: null, upcoming: false });
    expect(customerListFiltersSchema.parse({})).toMatchObject({
      tag: '',
      consent: null,
      upcoming: false,
    });
  });

  it('etichetta a più clienti: clienti scelti, etichetta e azione', () => {
    expect(
      customerBulkTagSchema.parse({ customerIds: id(1), tag: ' Día de las Madres ', mode: 'add' }),
    ).toEqual({ customerIds: [id(1)], tag: 'día de las madres', mode: 'add' });

    const none = customerBulkTagSchema.safeParse({ customerIds: [], tag: '', mode: 'x' });
    expect(none.success).toBe(false);
    if (!none.success) {
      expect(toFieldErrors(none.error)).toMatchObject({
        customerIds: 'customers_none_selected',
        tag: 'required',
        mode: 'invalid_option',
      });
    }
    const tooMany = customerBulkTagSchema.safeParse({
      customerIds: Array.from({ length: 101 }, (_, index) => id(index)),
      tag: 'vip',
      mode: 'remove',
    });
    expect(tooMany.success).toBe(false);
    const tooLong = customerBulkTagSchema.safeParse({
      customerIds: [id(1)],
      tag: 'x'.repeat(31),
      mode: 'add',
    });
    expect(tooLong.success).toBe(false);
  });

  it('fecha especial próxima: gli stessi giorni di nextOccurrence', () => {
    const zone = 'America/Mexico_City';
    for (const iso of [
      '2026-12-15T18:00:00Z', // a cavallo dell'anno
      '2027-02-10T18:00:00Z', // febbraio non bisestile: il 29 vale il 28
      '2028-02-10T18:00:00Z', // febbraio bisestile
      '2027-01-31T18:00:00Z', // tre mesi nella finestra
      '2026-11-24T05:00:00Z', // in Messico è ancora il 23
    ]) {
      const now = new Date(iso);
      const window = upcomingMonthDays(zone, 30, now);
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= 31; day += 1) {
          if (!isValidMonthDay(month, day)) continue;
          const inWindow = window.some(
            (entry) => entry.month === month && entry.days.includes(day),
          );
          expect([iso, month, day, inWindow]).toEqual([
            iso,
            month,
            day,
            nextOccurrence(month, day, zone, now).daysUntil <= 30,
          ]);
        }
      }
    }
    expect(upcomingMonthDays(zone, 30, new Date('2026-12-15T18:00:00Z'))).toEqual([
      { month: 12, days: Array.from({ length: 17 }, (_, index) => 15 + index) },
      { month: 1, days: Array.from({ length: 14 }, (_, index) => 1 + index) },
    ]);
  });
});
