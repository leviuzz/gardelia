import { describe, expect, it } from 'vitest';
import {
  customerAddressSchema,
  customerFormSchema,
  isPlatformSource,
  isValidMonthDay,
  nextOccurrence,
  occasionSchema,
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
