/**
 * Dati di riferimento della piattaforma: servono in OGNI ambiente, produzione compresa, non solo
 * nella demo. Oggi è la tassonomia dei fiori: nomi comuni nelle anteprime, misure del boceto,
 * collegamento degli articoli del catalogo.
 *
 * La fonte è questo file. `syncReferenceData` li allinea nel database a ogni rilascio, dopo le
 * migrazioni (`pnpm db:deploy`, build di produzione su Vercel), e prima dei test di
 * integrazione. È idempotente: inserisce i nuovi e riporta i valori di quelli esistenti a quelli
 * di questo file. Prima del 22/11/2026 la tassonomia la caricava solo il seed demo, che in
 * produzione non gira.
 */
import type { DbClient } from './client';
import { withSystemContext, type TransactionClient } from './tenancy';

export const CANONICAL_FLOWERS = [
  {
    slug: 'rosa',
    scientificName: 'Rosa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Rosa', 'it-IT': 'Rosa', 'en-US': 'Rose' },
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'peach', 'burgundy'],
  },
  {
    slug: 'tulipan',
    scientificName: 'Tulipa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Tulipán', 'it-IT': 'Tulipano', 'en-US': 'Tulip' },
    colors: ['red', 'pink', 'white', 'yellow', 'purple', 'orange'],
  },
  {
    slug: 'girasol',
    scientificName: 'Helianthus annuus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Girasol', 'it-IT': 'Girasole', 'en-US': 'Sunflower' },
    colors: ['yellow'],
  },
  {
    slug: 'lilium',
    scientificName: 'Lilium spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Lilium', 'it-IT': 'Giglio', 'en-US': 'Lily' },
    colors: ['white', 'pink', 'orange', 'yellow'],
  },
  {
    slug: 'gypsophila',
    scientificName: 'Gypsophila paniculata',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Nube (Gypsophila)', 'it-IT': 'Nebbiolina', 'en-US': "Baby's breath" },
    colors: ['white', 'pink'],
  },
  {
    slug: 'clavel',
    scientificName: 'Dianthus caryophyllus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Clavel', 'it-IT': 'Garofano', 'en-US': 'Carnation' },
    colors: ['red', 'pink', 'white', 'yellow', 'purple'],
  },
  {
    slug: 'hortensia',
    scientificName: 'Hydrangea macrophylla',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Hortensia', 'it-IT': 'Ortensia', 'en-US': 'Hydrangea' },
    colors: ['blue', 'pink', 'white', 'purple'],
  },
  {
    slug: 'peonia',
    scientificName: 'Paeonia lactiflora',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Peonía', 'it-IT': 'Peonia', 'en-US': 'Peony' },
    colors: ['pink', 'white', 'coral', 'burgundy'],
  },
  {
    slug: 'alstroemeria',
    scientificName: 'Alstroemeria spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Astromelia', 'it-IT': 'Alstroemeria', 'en-US': 'Peruvian lily' },
    colors: ['pink', 'white', 'yellow', 'orange', 'purple'],
  },
  {
    slug: 'gerbera',
    scientificName: 'Gerbera jamesonii',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Gerbera', 'it-IT': 'Gerbera', 'en-US': 'Gerbera' },
    colors: ['red', 'pink', 'orange', 'yellow', 'white'],
  },
  {
    slug: 'eucalipto',
    scientificName: 'Eucalyptus spp.',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Eucalipto', 'it-IT': 'Eucalipto', 'en-US': 'Eucalyptus' },
    colors: ['green'],
  },
  {
    slug: 'ruscus',
    scientificName: 'Ruscus hypophyllum',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Ruscus', 'it-IT': 'Ruscus', 'en-US': 'Ruscus' },
    colors: ['green'],
  },
  {
    slug: 'orquidea-phalaenopsis',
    scientificName: 'Phalaenopsis spp.',
    category: 'PLANT',
    names: {
      'es-MX': 'Orquídea Phalaenopsis',
      'it-IT': 'Orchidea Phalaenopsis',
      'en-US': 'Moth orchid',
    },
    colors: ['white', 'purple', 'pink'],
  },
  {
    slug: 'monstera',
    scientificName: 'Monstera deliciosa',
    category: 'PLANT',
    names: { 'es-MX': 'Monstera', 'it-IT': 'Monstera', 'en-US': 'Monstera' },
    colors: ['green'],
  },
] as const;

/** Inserisce o aggiorna la tassonomia in una transazione già in contesto di sistema. */
export async function upsertCanonicalFlowers(tx: TransactionClient): Promise<number> {
  for (const flower of CANONICAL_FLOWERS) {
    const data = {
      scientificName: flower.scientificName,
      category: flower.category,
      names: flower.names,
      colors: [...flower.colors],
    };
    await tx.canonicalFlower.upsert({
      where: { slug: flower.slug },
      update: data,
      create: { slug: flower.slug, ...data },
    });
  }
  return CANONICAL_FLOWERS.length;
}

/** Allinea tutti i dati di riferimento (una transazione). */
export async function syncReferenceData(
  db: DbClient,
): Promise<{ readonly canonicalFlowers: number }> {
  const canonicalFlowers = await withSystemContext(
    db,
    { reason: 'rilascio: dati di riferimento della piattaforma' },
    (tx) => upsertCanonicalFlowers(tx),
  );
  return { canonicalFlowers };
}
