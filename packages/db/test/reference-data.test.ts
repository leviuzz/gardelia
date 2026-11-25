/**
 * Dati di riferimento (tassonomia dei fiori): arrivano con il rilascio, non con il seed demo, e
 * l'allineamento è idempotente. Il global setup dei test li allinea come farebbe un deploy.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  CATALOG_COLORS,
  SUPPORTED_LOCALES,
  normalizeSpeciesText,
  parsePlantCare,
  speciesOption,
  suggestSpecies,
} from '@floral/domain';
import { disconnectDb, getDb, withSystemContext } from '../src/index';
import { CANONICAL_FLOWERS, syncReferenceData } from '../src/reference-data';

const db = getDb();

afterAll(async () => {
  await disconnectDb();
});

async function flowers() {
  return withSystemContext(db, { reason: 'test: dati di riferimento' }, (tx) =>
    tx.canonicalFlower.findMany({ select: { slug: true, names: true, synonyms: true } }),
  );
}

/** Slug che esistevano prima dell'ampliamento (ADR-043): articoli e seed vi sono collegati. */
const ORIGINAL_SLUGS = [
  'rosa',
  'tulipan',
  'girasol',
  'lilium',
  'gypsophila',
  'clavel',
  'hortensia',
  'peonia',
  'alstroemeria',
  'gerbera',
  'eucalipto',
  'ruscus',
  'orquidea-phalaenopsis',
  'monstera',
];

/** Tutti i nomi e sinonimi di una specie, in tutte le lingue. */
function allTerms(flower: (typeof CANONICAL_FLOWERS)[number]): string[] {
  return SUPPORTED_LOCALES.flatMap((locale) => [
    flower.names[locale],
    ...(flower.synonyms[locale] ?? []),
  ]);
}

describe('elenco delle specie (ADR-043)', () => {
  it('slug unici, nomi nelle tre lingue, colori del vocabolario; gli slug storici restano', () => {
    const slugs = CANONICAL_FLOWERS.map((flower) => flower.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(CANONICAL_FLOWERS.length).toBeGreaterThanOrEqual(70);
    for (const slug of ORIGINAL_SLUGS) expect(slugs).toContain(slug);
    for (const flower of CANONICAL_FLOWERS) {
      for (const locale of SUPPORTED_LOCALES) expect(flower.names[locale].trim()).not.toBe('');
      for (const color of flower.colors) expect(CATALOG_COLORS).toContain(color);
      expect(flower.scientificName.trim()).not.toBe('');
    }
  });

  it('ogni nome o sinonimo indica una sola specie della stessa categoria', () => {
    const owner = new Map<string, string>();
    for (const flower of CANONICAL_FLOWERS) {
      for (const term of new Set(allTerms(flower).map(normalizeSpeciesText))) {
        const key = `${flower.category}:${term}`;
        expect(owner.get(key) ?? flower.slug, `"${term}"`).toBe(flower.slug);
        owner.set(key, flower.slug);
      }
    }
  });

  it('ogni pianta in vaso ha i dati di cura validi, non ancora rivisti; le altre no (ADR-085)', () => {
    for (const flower of CANONICAL_FLOWERS) {
      if (flower.category === 'PLANT') {
        expect(parsePlantCare(flower.care), flower.slug).toEqual(flower.care);
        expect(flower.care?.reviewed, flower.slug).toBe(false);
      } else {
        expect(flower.care, flower.slug).toBeUndefined();
      }
    }
    // Le piante d'interno aggiunte per l'Asistente de plantas.
    const plants = CANONICAL_FLOWERS.filter((flower) => flower.category === 'PLANT');
    expect(plants.length).toBeGreaterThanOrEqual(36);
    for (const slug of ['palma-areca', 'calathea', 'aglaonema', 'filodendro', 'hule']) {
      expect(plants.map((flower) => flower.slug)).toContain(slug);
    }
  });

  it('il nome del prodotto uguale a un nome o sinonimo suggerisce proprio quella specie', () => {
    for (const category of ['CUT_FLOWER', 'FOLIAGE', 'PLANT'] as const) {
      const inCategory = CANONICAL_FLOWERS.filter((flower) => flower.category === category);
      const options = inCategory.map((flower) =>
        speciesOption(
          {
            id: flower.slug,
            category: flower.category,
            scientificName: flower.scientificName,
            names: flower.names,
            synonyms: flower.synonyms,
          },
          'es-MX',
        ),
      );
      for (const flower of inCategory) {
        for (const term of allTerms(flower)) {
          expect(suggestSpecies(term, options)?.id, `"${term}"`).toBe(flower.slug);
        }
      }
    }
  });
});

describe('dati di riferimento della piattaforma', () => {
  it('la tassonomia completa c’è anche senza il seed demo', async () => {
    const rows = await flowers();
    const slugs = new Set(rows.map((row) => row.slug));
    for (const flower of CANONICAL_FLOWERS) expect(slugs.has(flower.slug)).toBe(true);
    expect(rows.find((row) => row.slug === 'rosa')?.names).toMatchObject({ 'es-MX': 'Rosa' });
    expect(rows.find((row) => row.slug === 'gypsophila')?.synonyms).toMatchObject({
      'es-MX': expect.arrayContaining(['Nube']),
    });
  });

  it('i dati di cura arrivano nel database con le piante (ADR-085)', async () => {
    const rows = await withSystemContext(db, { reason: 'test: dati di cura' }, (tx) =>
      tx.canonicalFlower.findMany({
        where: { slug: { in: ['telefono', 'rosa'] } },
        select: { slug: true, care: true },
      }),
    );
    expect(parsePlantCare(rows.find((row) => row.slug === 'telefono')?.care)).toMatchObject({
      light: 'LOW',
      petToxicity: 'TOXIC',
      toxicitySource: 'ASPCA',
      reviewed: false,
    });
    expect(rows.find((row) => row.slug === 'rosa')?.care).toBeNull();
  });

  it('allineare di nuovo non duplica e riporta i valori a quelli del codice', async () => {
    await withSystemContext(db, { reason: 'test: valore cambiato a mano' }, (tx) =>
      tx.canonicalFlower.update({
        where: { slug: 'rosa' },
        data: { names: { 'es-MX': 'Rosita', 'it-IT': 'Rosa', 'en-US': 'Rose' } },
      }),
    );
    const before = (await flowers()).length;
    await syncReferenceData(db);
    await syncReferenceData(db);
    const after = await flowers();
    expect(after).toHaveLength(before);
    expect(after.find((row) => row.slug === 'rosa')?.names).toMatchObject({ 'es-MX': 'Rosa' });
  });
});
