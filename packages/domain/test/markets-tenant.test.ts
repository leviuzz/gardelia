import { describe, expect, it } from 'vitest';
import { ENABLED_MARKETS, isValidMexicanRfc, normalizePhone } from '../src/markets';
import { onboardingSchema } from '../src/tenant';
import { toFieldErrors } from '../src/validation';

describe('mercati', () => {
  it('al lancio è abilitato solo il Messico', () => {
    expect(ENABLED_MARKETS).toEqual(['MX']);
  });

  it.each([
    ['449 123 4567', '+524491234567'],
    ['(449) 123-4567', '+524491234567'],
    ['+52 449 123 4567', '+524491234567'],
    ['52 1 449 123 4567', '+524491234567'],
  ])('normalizza il telefono messicano %s', (input, expected) => {
    expect(normalizePhone(input, 'MX')).toBe(expected);
  });

  it('rifiuta telefoni non riconoscibili', () => {
    expect(normalizePhone('12345', 'MX')).toBeNull();
    expect(normalizePhone('', 'MX')).toBeNull();
  });

  it('valida la sintassi dell’RFC', () => {
    expect(isValidMexicanRfc('FLC190312AB1')).toBe(true); // persona moral
    expect(isValidMexicanRfc('LOPM850101XY2')).toBe(true); // persona física
    expect(isValidMexicanRfc('ABC')).toBe(false);
  });
});

describe('schema di onboarding (MX)', () => {
  const schema = onboardingSchema('MX');
  const valid = {
    displayName: '  Florería Las Camelias ',
    legalName: '',
    taxId: 'flc190312ab1',
    contactEmail: 'Hola@LasCamelias.test',
    contactPhone: '449 123 4567',
    timezone: 'America/Mexico_City',
    location: {
      addressLine1: 'Av. Madero 120',
      addressLine2: '',
      neighborhood: 'Zona Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      phone: '',
      deliveryRadiusKm: '8',
    },
  };

  it('normalizza un input valido', () => {
    const result = schema.parse(valid);
    expect(result.displayName).toBe('Florería Las Camelias');
    expect(result.legalName).toBeNull();
    expect(result.taxId).toBe('FLC190312AB1');
    expect(result.contactEmail).toBe('hola@lascamelias.test');
    expect(result.contactPhone).toBe('+524491234567');
    expect(result.location.deliveryRadiusKm).toBe(8);
    expect(result.location.phone).toBeNull();
  });

  it('restituisce codici di errore per campo', () => {
    const result = schema.safeParse({
      ...valid,
      displayName: '',
      timezone: 'Europe/Rome',
      location: { ...valid.location, region: 'XXX', postalCode: '2000', deliveryRadiusKm: '-1' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldErrors(result.error)).toMatchObject({
      displayName: 'required',
      timezone: 'invalid_option',
      'location.region': 'invalid_option',
      'location.postalCode': 'invalid_postal_code',
      'location.deliveryRadiusKm': 'out_of_range',
    });
  });
});
