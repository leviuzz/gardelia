import { describe, expect, it } from 'vitest';
import { catalogItemFormSchema, catalogItemInputSchema, isServiceType } from '../src/index';

/** Proveedor habitual, durata e raggio dei servizi (ADR-081). */

const base = {
  type: 'CUT_FLOWER',
  name: 'Rosa roja',
  description: null,
  sku: null,
  canonicalFlowerId: null,
  variety: null,
  colors: [],
  saleUnit: 'STEM',
  priceMinor: 3500,
  costMinor: null,
  availability: 'AVAILABLE',
  prepMinutes: 10,
  heightCm: null,
  widthCm: null,
  tags: [],
};
const SUPPLIER = '0193a1b2-0000-7000-8000-000000000001';

describe('catalogo: proveedor e servizi', () => {
  it('i prodotti hanno il proveedor; durata e raggio si scartano', () => {
    const parsed = catalogItemInputSchema.parse({
      ...base,
      supplierId: SUPPLIER,
      serviceDurationMinutes: 60,
      serviceRadiusKm: 10,
    });
    expect(parsed).toMatchObject({
      supplierId: SUPPLIER,
      serviceDurationMinutes: null,
      serviceRadiusKm: null,
      prepMinutes: 10,
    });
  });

  it('i servizi hanno durata e raggio, non il proveedor né il tempo di preparazione', () => {
    const parsed = catalogItemInputSchema.parse({
      ...base,
      type: 'SERVICE',
      saleUnit: 'SERVICE',
      supplierId: SUPPLIER,
      serviceDurationMinutes: 180,
      serviceRadiusKm: 25,
    });
    expect(parsed).toMatchObject({
      supplierId: null,
      serviceDurationMinutes: 180,
      serviceRadiusKm: 25,
      prepMinutes: null,
    });
    expect(isServiceType('SERVICE_ADDON')).toBe(true);
    expect(isServiceType('BOUQUET')).toBe(false);
  });

  it('limiti: durata fino a 24 ore, raggio da 1 a 200 km', () => {
    const service = { ...base, type: 'SERVICE', saleUnit: 'SERVICE' };
    expect(catalogItemInputSchema.safeParse({ ...service, serviceRadiusKm: 0 }).success).toBe(
      false,
    );
    expect(catalogItemInputSchema.safeParse({ ...service, serviceRadiusKm: 201 }).success).toBe(
      false,
    );
    expect(
      catalogItemInputSchema.safeParse({ ...service, serviceDurationMinutes: 24 * 60 + 1 }).success,
    ).toBe(false);
  });

  it('dal form: un campo assente non cambia nulla, vuoto lo toglie', () => {
    const form = {
      type: 'CUT_FLOWER',
      name: 'Rosa roja',
      saleUnit: 'STEM',
      price: '35',
      availability: 'AVAILABLE',
    };
    const schema = catalogItemFormSchema('MXN');
    expect(schema.parse(form).supplierId).toBeUndefined();
    expect(schema.parse({ ...form, supplierId: '' }).supplierId).toBeNull();
    expect(schema.parse({ ...form, supplierId: SUPPLIER }).supplierId).toBe(SUPPLIER);
    const service = schema.parse({
      ...form,
      type: 'SERVICE',
      saleUnit: 'SERVICE',
      serviceDurationMinutes: '90',
      serviceRadiusKm: '12',
    });
    expect(service).toMatchObject({ serviceDurationMinutes: 90, serviceRadiusKm: 12 });
    expect(
      schema.safeParse({ ...form, type: 'SERVICE', saleUnit: 'SERVICE', serviceRadiusKm: 'lejos' })
        .success,
    ).toBe(false);
  });
});
