import { describe, expect, it } from 'vitest';
import {
  SERVICE_REQUEST_LIMITS,
  canBuyerCancelServiceRequest,
  canShopDeclineServiceRequest,
  formatServiceRequestNumber,
  can,
  isPresetServiceKind,
  parseServiceRequestAnswers,
  serviceDeclineReasonText,
  serviceDeclineSchema,
  serviceRequestAnswers,
  serviceRequestDateProblem,
  serviceRequestNeedsAddress,
  serviceRequestProblem,
  serviceRequestSchema,
  storefrontServiceDisplayName,
  storefrontServicePublishProblem,
  storefrontServiceSchema,
} from '../src/index';

const KEY = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const base = { contactPhone: '449 555 0123', submitKey: KEY };
const preset = (kind: 'EVENT' | 'VENUE' | 'WEEKLY' | 'CARE') => ({
  kind,
  askDate: false,
  askAddress: false,
});

describe('servizi della vetrina (M5)', () => {
  it('i predefiniti hanno il nome dato dalla lingua; quelli della fioreria il loro', () => {
    expect(isPresetServiceKind('EVENT')).toBe(true);
    expect(isPresetServiceKind('CUSTOM')).toBe(false);
    expect(storefrontServiceDisplayName({ kind: 'EVENT', name: null })).toBe('Eventos y bodas');
    expect(storefrontServiceDisplayName({ kind: 'CUSTOM', name: 'Coronas fúnebres' })).toBe(
      'Coronas fúnebres',
    );
  });

  it('il nome è obbligatorio solo per un servizio della fioreria; «da $X» in centesimi', () => {
    const custom = storefrontServiceSchema('MXN', 'CUSTOM').safeParse({
      name: '',
      priceFrom: '1500',
    });
    expect(custom.success).toBe(false);
    const parsed = storefrontServiceSchema('MXN', 'CUSTOM').parse({
      name: ' Arreglos para iglesia ',
      description: 'Altar y bancas',
      priceFrom: '1500.50',
      askDate: 'on',
    });
    expect(parsed).toMatchObject({
      name: 'Arreglos para iglesia',
      priceFrom: 150050,
      askDate: true,
      askAddress: false,
    });
    // Un predefinito ignora nome e domande del modulo (ha il suo).
    expect(
      storefrontServiceSchema('MXN', 'EVENT').parse({
        name: 'Altro',
        askDate: 'on',
        priceFrom: '',
      }),
    ).toMatchObject({ name: null, askDate: false, priceFrom: null });
  });

  it('Floral Care si pubblica solo con l’offerta pronta', () => {
    expect(storefrontServicePublishProblem({ kind: 'CARE', careReady: false })).toBe(
      'service_care_not_ready',
    );
    expect(storefrontServicePublishProblem({ kind: 'CARE', careReady: true })).toBeNull();
    expect(storefrontServicePublishProblem({ kind: 'EVENT', careReady: false })).toBeNull();
  });
});

describe('richieste di chi compra (M5)', () => {
  it('evento: data, tipo, invitati, luogo; budget facoltativo', () => {
    const schema = serviceRequestSchema(preset('EVENT'), 'MX', 'MXN');
    const parsed = schema.parse({
      ...base,
      date: '2026-12-20',
      eventType: 'WEDDING',
      guests: '120',
      place: 'Jardín Las Palmas, Aguascalientes',
      budget: '',
    });
    expect(parsed).toMatchObject({
      kind: 'EVENT',
      date: { year: 2026, month: 12, day: 20 },
      guests: 120,
      budget: null,
      message: null,
    });
    expect(serviceRequestAnswers(parsed)).toEqual({
      eventType: 'WEDDING',
      guests: 120,
      place: 'Jardín Las Palmas, Aguascalientes',
    });
    const wrong = schema.safeParse({
      ...base,
      date: '',
      eventType: 'PARTY',
      guests: '0',
      place: '',
    });
    expect(wrong.success).toBe(false);
    const fields = wrong.success ? [] : wrong.error.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(['date', 'eventType', 'guests', 'place']));
  });

  it('ogni settimana: giorno, fascia facoltativa e durata nel JSON', () => {
    const parsed = serviceRequestSchema(preset('WEEKLY'), 'MX', 'MXN').parse({
      ...base,
      date: '2026-12-07',
      weekday: '1',
      window: '09:00-12:00',
      duration: 'THREE_MONTHS',
      budget: '450',
    });
    expect(serviceRequestAnswers(parsed)).toEqual({
      weekday: 1,
      windowStartMinutes: 540,
      windowEndMinutes: 720,
      duration: 'THREE_MONTHS',
    });
    expect(
      serviceRequestSchema(preset('WEEKLY'), 'MX', 'MXN').safeParse({
        ...base,
        date: '2026-12-07',
        weekday: '7',
        window: '12:00-09:00',
        duration: 'OPEN',
      }).success,
    ).toBe(false);
  });

  it('Floral Care: piante e frequenza; il servizio della fioreria vuole il messaggio', () => {
    const care = serviceRequestSchema(preset('CARE'), 'MX', 'MXN').parse({
      ...base,
      plants: '12',
      frequency: 'MONTHLY_2',
    });
    expect(serviceRequestAnswers(care)).toEqual({ plants: 12, frequency: 'MONTHLY_2' });
    const custom = { kind: 'CUSTOM' as const, askDate: true, askAddress: false };
    expect(
      serviceRequestSchema(custom, 'MX', 'MXN').safeParse({ ...base, message: ' ' }).success,
    ).toBe(false);
    const parsed = serviceRequestSchema(custom, 'MX', 'MXN').parse({
      ...base,
      message: 'Corona para el viernes',
      date: '',
    });
    expect(parsed).toMatchObject({ kind: 'CUSTOM', date: null });
    // Senza la domanda della data, la data si ignora.
    expect(
      serviceRequestSchema({ ...custom, askDate: false }, 'MX', 'MXN').parse({
        ...base,
        message: 'Hola',
        date: '2026-12-20',
      }),
    ).toMatchObject({ kind: 'CUSTOM', date: null });
  });

  it('telefono e chiave del modulo sempre obbligatori', () => {
    const result = serviceRequestSchema(preset('CARE'), 'MX', 'MXN').safeParse({
      plants: '3',
      frequency: 'WEEKLY',
      contactPhone: '',
      submitKey: 'no',
    });
    expect(result.success).toBe(false);
    const fields = result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(['contactPhone', 'submitKey']));
  });

  it('l’indirizzo serve a locale, ogni settimana e Floral Care; al servizio della fioreria se lo chiede', () => {
    expect(serviceRequestNeedsAddress(preset('EVENT'))).toBe(false);
    expect(serviceRequestNeedsAddress(preset('VENUE'))).toBe(true);
    expect(serviceRequestNeedsAddress(preset('WEEKLY'))).toBe(true);
    expect(serviceRequestNeedsAddress(preset('CARE'))).toBe(true);
    expect(serviceRequestNeedsAddress({ kind: 'CUSTOM', askDate: false, askAddress: true })).toBe(
      true,
    );
    expect(serviceRequestNeedsAddress({ kind: 'CUSTOM', askDate: false, askAddress: false })).toBe(
      false,
    );
  });

  it('la data da domani a 12 mesi', () => {
    const today = { year: 2026, month: 11, day: 28 };
    expect(serviceRequestDateProblem(today, today)).toBe('service_date_too_soon');
    expect(serviceRequestDateProblem({ year: 2026, month: 11, day: 29 }, today)).toBeNull();
    expect(serviceRequestDateProblem({ year: 2027, month: 11, day: 28 }, today)).toBeNull();
    expect(serviceRequestDateProblem({ year: 2027, month: 11, day: 29 }, today)).toBe(
      'service_date_too_far',
    );
    expect(serviceRequestDateProblem(null, today)).toBeNull();
  });

  it('servizio disponibile, Floral Care pronto, al massimo 5 aperte', () => {
    const ok = { available: true, kind: 'EVENT' as const, careReady: false, openRequests: 0 };
    expect(serviceRequestProblem(ok)).toBeNull();
    expect(serviceRequestProblem({ ...ok, available: false })).toBe('service_unavailable');
    expect(serviceRequestProblem({ ...ok, kind: 'CARE' })).toBe('service_care_not_ready');
    expect(
      serviceRequestProblem({ ...ok, openRequests: SERVICE_REQUEST_LIMITS.openPerBuyer }),
    ).toBe('service_requests_open_limit');
    expect(
      serviceRequestProblem({ ...ok, openRequests: SERVICE_REQUEST_LIMITS.openPerBuyer - 1 }),
    ).toBeNull();
  });

  it('stati: si annulla e si rifiuta finché è aperta; il numero «SOL-»', () => {
    expect(canBuyerCancelServiceRequest('NEW')).toBe(true);
    expect(canBuyerCancelServiceRequest('QUOTED')).toBe(true);
    expect(canBuyerCancelServiceRequest('ACCEPTED')).toBe(false);
    expect(canShopDeclineServiceRequest('DECLINED')).toBe(false);
    expect(canShopDeclineServiceRequest('CANCELLED')).toBe(false);
    expect(formatServiceRequestNumber(3)).toBe('SOL-0003');
    expect(formatServiceRequestNumber(12345)).toBe('SOL-12345');
  });

  it('le risposte lette dal database: JSON strano = niente', () => {
    expect(parseServiceRequestAnswers({ guests: 40, eventType: 'XV' })).toEqual({
      guests: 40,
      eventType: 'XV',
    });
    expect(parseServiceRequestAnswers({ guests: -1 })).toBeNull();
    expect(parseServiceRequestAnswers({ extra: 'x' })).toBeNull();
    expect(parseServiceRequestAnswers('nope')).toBeNull();
  });

  it('«Rifiuta»: un motivo pronto, con «Altro» il dettaglio obbligatorio', () => {
    expect(serviceDeclineSchema.safeParse({ reasonCode: 'OTHER', detail: '' }).success).toBe(false);
    const parsed = serviceDeclineSchema.parse({ reasonCode: 'OUT_OF_AREA', detail: '' });
    expect(serviceDeclineReasonText(parsed.reasonCode, parsed.detail)).toBe(
      'No llegamos a ese lugar.',
    );
    expect(serviceDeclineReasonText('NO_AVAILABILITY', 'Esa semana cerramos.')).toBe(
      'No tenemos disponibilidad para esa fecha. Esa semana cerramos.',
    );
    expect(serviceDeclineReasonText('OTHER', 'Solo hacemos bodas.')).toBe('Solo hacemos bodas.');
  });

  it('permessi: tutta la squadra vede le richieste, proprietario e gerente rispondono', () => {
    expect(can('STAFF', 'requests:read')).toBe(true);
    expect(can('STAFF', 'requests:write')).toBe(false);
    expect(can('MANAGER', 'requests:write')).toBe(true);
    expect(can('OWNER', 'requests:write')).toBe(true);
  });
});
