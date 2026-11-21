import { describe, expect, it } from 'vitest';
import {
  PHOTO_LIMITS,
  allowsPhotos,
  catalogPhotoInputSchema,
  canRequestCutout,
  judgeCutout,
  photoByColor,
  styleReferenceInputSchema,
  toFieldErrors,
} from '../src';

describe('foto del catalogo', () => {
  it('vista predefinita "frente" e colore facoltativo', () => {
    expect(catalogPhotoInputSchema.parse({})).toEqual({ view: 'FRONT', color: null });
    expect(catalogPhotoInputSchema.parse({ view: 'SIDE', color: ' pink ' })).toEqual({
      view: 'SIDE',
      color: 'pink',
    });
  });

  it('rifiuta viste e colori fuori elenco con codici traducibili', () => {
    const result = catalogPhotoInputSchema.safeParse({ view: 'BACK', color: 'neon' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toEqual({
        view: 'invalid_option',
        color: 'invalid_option',
      });
    }
  });

  it('servizi senza foto; carte, vasi e nastri con una foto per colore', () => {
    expect(allowsPhotos('CUT_FLOWER')).toBe(true);
    expect(allowsPhotos('PACKAGING')).toBe(true);
    expect(allowsPhotos('SERVICE')).toBe(false);
    expect(allowsPhotos('SERVICE_ADDON')).toBe(false);
    expect(photoByColor('PACKAGING')).toBe(true);
    expect(photoByColor('ACCESSORY')).toBe(true);
    expect(photoByColor('CUT_FLOWER')).toBe(false);
  });
});

describe('Mis ramos', () => {
  it('senza consenso esplicito non si carica nulla', () => {
    const result = styleReferenceInputSchema.safeParse({ style: '', caption: '' });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(toFieldErrors(result.error)).toEqual({ consent: 'consent_required' });
  });

  it('con il consenso: stile e nota facoltativi', () => {
    expect(styleReferenceInputSchema.parse({ consent: 'on', style: '', caption: '  ' })).toEqual({
      consent: true,
      style: null,
      caption: null,
    });
    expect(
      styleReferenceInputSchema.parse({
        consent: 'on',
        style: 'GARDEN',
        caption: 'Boda en Calvillo',
      }),
    ).toEqual({ consent: true, style: 'GARDEN', caption: 'Boda en Calvillo' });
  });

  it('nota troppo lunga e stile sconosciuto', () => {
    const result = styleReferenceInputSchema.safeParse({
      consent: 'on',
      style: 'BAROQUE',
      caption: 'x'.repeat(PHOTO_LIMITS.caption + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toEqual({ style: 'invalid_option', caption: 'too_long' });
    }
  });
});

describe('controllo dello scontorno', () => {
  it('accetta un soggetto ragionevole, rifiuta ritagli vuoti o con tutto il fondo', () => {
    expect(judgeCutout(0.35)).toBeNull();
    expect(judgeCutout(0.01)).toBe('cutout_nothing_kept');
    expect(judgeCutout(Number.NaN)).toBe('cutout_nothing_kept');
    expect(judgeCutout(0.99)).toBe('cutout_background_kept');
  });

  it('lo scontorno si richiede solo se non fatto o se il servizio ha fallito', () => {
    expect(canRequestCutout(null, null)).toBe(true);
    expect(canRequestCutout('FAILED', 'cutout_failed')).toBe(true);
    // Scartato dal controllo di qualità: stessa foto, stesso risultato.
    expect(canRequestCutout('FAILED', 'cutout_nothing_kept')).toBe(false);
    expect(canRequestCutout('FAILED', 'cutout_background_kept')).toBe(false);
    expect(canRequestCutout('PENDING', null)).toBe(false);
    expect(canRequestCutout('READY', null)).toBe(false);
  });
});
