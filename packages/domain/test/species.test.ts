import { describe, expect, it } from 'vitest';
import { englishPlural } from '../src/ai';
import {
  normalizeSpeciesText,
  searchSpecies,
  speciesOption,
  suggestSpecies,
  type SpeciesSource,
} from '../src/species';
import type { SupportedLocale } from '../src/i18n';
import { typicalBloomCm } from '../src/sketch';

/** Un estratto della tassonomia (la lista vera è in packages/db/src/reference-data.ts). */
const SOURCES: readonly SpeciesSource[] = [
  {
    id: 'rosa',
    category: 'CUT_FLOWER',
    scientificName: 'Rosa spp.',
    names: { 'es-MX': 'Rosa', 'it-IT': 'Rosa', 'en-US': 'Rose' },
    synonyms: {},
  },
  {
    id: 'rosa-spray',
    category: 'CUT_FLOWER',
    scientificName: 'Rosa spp. (spray)',
    names: { 'es-MX': 'Mini rosa', 'it-IT': 'Rosa ramificata', 'en-US': 'Spray rose' },
    synonyms: { 'es-MX': ['Rosa spray'] },
  },
  {
    id: 'clavel',
    category: 'CUT_FLOWER',
    scientificName: 'Dianthus caryophyllus',
    names: { 'es-MX': 'Clavel', 'it-IT': 'Garofano', 'en-US': 'Carnation' },
    synonyms: {},
  },
  {
    id: 'clavel-mini',
    category: 'CUT_FLOWER',
    scientificName: 'Dianthus caryophyllus (spray)',
    names: { 'es-MX': 'Mini clavel', 'it-IT': 'Garofanino', 'en-US': 'Spray carnation' },
    synonyms: { 'es-MX': ['Clavel spray'] },
  },
  {
    id: 'gypsophila',
    category: 'CUT_FLOWER',
    scientificName: 'Gypsophila paniculata',
    names: { 'es-MX': 'Nube (Gypsophila)', 'it-IT': 'Nebbiolina', 'en-US': "Baby's breath" },
    synonyms: { 'es-MX': ['Nube', 'Paniculata'], 'it-IT': ['Velo da sposa'] },
  },
  {
    id: 'girasol',
    category: 'CUT_FLOWER',
    scientificName: 'Helianthus annuus',
    names: { 'es-MX': 'Girasol', 'it-IT': 'Girasole', 'en-US': 'Sunflower' },
    synonyms: {},
  },
  {
    id: 'alcatraz',
    category: 'CUT_FLOWER',
    scientificName: 'Zantedeschia aethiopica',
    names: { 'es-MX': 'Alcatraz', 'it-IT': 'Calla', 'en-US': 'Calla lily' },
    synonyms: { 'es-MX': ['Cartucho'] },
  },
  {
    id: 'lilium',
    category: 'CUT_FLOWER',
    scientificName: 'Lilium spp.',
    names: { 'es-MX': 'Lilium', 'it-IT': 'Giglio', 'en-US': 'Lily' },
    synonyms: {},
  },
  {
    id: 'agapando',
    category: 'CUT_FLOWER',
    scientificName: 'Agapanthus africanus',
    names: { 'es-MX': 'Agapando', 'it-IT': 'Agapanto', 'en-US': 'Agapanthus' },
    synonyms: { 'en-US': ['Lily of the Nile'] },
  },
  {
    id: 'lavanda',
    category: 'CUT_FLOWER',
    scientificName: 'Lavandula angustifolia',
    names: { 'es-MX': 'Lavanda', 'it-IT': 'Lavanda', 'en-US': 'Lavender' },
    synonyms: {},
  },
];

const optionsIn = (locale: SupportedLocale) =>
  SOURCES.map((source) => speciesOption(source, locale));
const ids = (locale: SupportedLocale, query: string) =>
  searchSpecies(query, optionsIn(locale), locale).map((match) => match.option.id);
const suggested = (name: string) => suggestSpecies(name, optionsIn('es-MX'))?.id ?? null;

describe('specie: testo normalizzato', () => {
  it('minuscole, senza accenti né punteggiatura', () => {
    expect(normalizeSpeciesText('  Ave del Paraíso ')).toBe('ave del paraiso');
    expect(normalizeSpeciesText("Baby's breath")).toBe('baby s breath');
    expect(normalizeSpeciesText('Nube (Gypsophila)')).toBe('nube gypsophila');
  });

  it('nome nella lingua di chi usa l’app; il nome scientifico senza "spp."', () => {
    const rosa = speciesOption(SOURCES[0]!, 'it-IT');
    expect(rosa.name).toBe('Rosa');
    // "Rosa spp." coincide con il nome: non si ripete.
    expect(rosa.scientificTerm).toBeNull();
    const clavel = speciesOption(SOURCES[2]!, 'en-US');
    expect(clavel.name).toBe('Carnation');
    expect(clavel.scientificTerm?.key).toBe('dianthus caryophyllus');
    expect(speciesOption(SOURCES[1]!, 'it-IT').scientificTerm?.key).toBe('rosa');
    // Lingua senza nome: si ripiega sullo spagnolo.
    const unnamed = speciesOption({ ...SOURCES[0]!, names: { 'es-MX': 'Rosa' } }, 'en-US');
    expect(unnamed.name).toBe('Rosa');
  });
});

describe('specie: ricerca nella lingua di chi usa l’app', () => {
  it('lo stesso fiore si cerca con il nome della propria lingua', () => {
    expect(ids('it-IT', 'garofano')[0]).toBe('clavel');
    expect(ids('es-MX', 'clavel')).toEqual(['clavel', 'clavel-mini']);
    expect(ids('en-US', 'carnation')).toEqual(['clavel', 'clavel-mini']);
  });

  it('prima i nomi della propria lingua, poi le altre lingue', () => {
    // In italiano "Calla" è l'alcatraz; "Carnation" e "Spray carnation" (inglese) vengono dopo.
    expect(ids('it-IT', 'ca')).toEqual(['alcatraz', 'clavel', 'clavel-mini']);
    // In spagnolo "lily" trova i nomi inglesi, il nome esatto per primo.
    expect(ids('es-MX', 'lily')).toEqual(['lilium', 'agapando', 'alcatraz']);
  });

  it('dice con quale altro nome l’ha trovata', () => {
    const [nube] = searchSpecies('paniculata', optionsIn('es-MX'), 'es-MX');
    expect(nube?.option.id).toBe('gypsophila');
    expect(nube?.matchedTerm).toBe('Paniculata');
    const [byName] = searchSpecies('nube', optionsIn('es-MX'), 'es-MX');
    expect(byName?.matchedTerm).toBeNull();
    const [italian] = searchSpecies('garofano', optionsIn('es-MX'), 'es-MX');
    expect(italian?.option.id).toBe('clavel');
    expect(italian?.matchedTerm).toBe('Garofano');
  });

  it('anche con il nome scientifico, senza accenti e da metà nome', () => {
    expect(ids('es-MX', 'Dianthus')).toEqual(['clavel', 'clavel-mini']);
    expect(ids('es-MX', 'gypso')).toEqual(['gypsophila']);
    expect(ids('es-MX', 'mini')).toEqual(['clavel-mini', 'rosa-spray']);
    expect(ids('es-MX', 'xyz')).toEqual([]);
  });

  it('prima chi ha il nome che inizia così, poi i sinonimi; dentro i sinonimi non a metà', () => {
    // "Rosa" (nome) prima di "Mini rosa" (sinonimo "Rosa spray").
    expect(ids('es-MX', 'ro')).toEqual(['rosa', 'rosa-spray']);
    const [first] = searchSpecies('ro', optionsIn('es-MX'), 'es-MX');
    expect(first?.matchedTerm).toBeNull();
    // "spray" è a metà del sinonimo "Rosa spray": le trova solo il nome inglese ("Spray rose").
    const spray = searchSpecies('spray', optionsIn('es-MX'), 'es-MX');
    expect(spray.map((match) => match.option.id)).toEqual(['clavel-mini', 'rosa-spray']);
    expect(spray.map((match) => match.matchedTerm)).toEqual(['Spray carnation', 'Spray rose']);
  });

  it('ricerca vuota: tutte, in ordine alfabetico nella lingua', () => {
    const all = searchSpecies('', optionsIn('it-IT'), 'it-IT').map((match) => match.option.name);
    expect(all).toHaveLength(SOURCES.length);
    expect(all.slice(0, 3)).toEqual(['Agapanto', 'Calla', 'Garofanino']);
  });
});

describe('specie suggerita dal nome del prodotto', () => {
  it('riconosce il fiore in qualunque lingua', () => {
    expect(suggested('Rosa roja Freedom')).toBe('rosa');
    expect(suggested('Garofano bianco')).toBe('clavel');
    expect(suggested('Red carnation')).toBe('clavel');
    expect(suggested('Nube blanca')).toBe('gypsophila');
    expect(suggested('Cartucho')).toBe('alcatraz');
  });

  it('vince il fiore che viene prima; a parità, il nome più lungo', () => {
    expect(suggested('Clavel rosa')).toBe('clavel');
    expect(suggested('Mini rosa roja')).toBe('rosa-spray');
    expect(suggested('Rosa spray blanca')).toBe('rosa-spray');
    expect(suggested('Mini clavel morado')).toBe('clavel-mini');
    expect(suggested('Lily of the Nile azul')).toBe('agapando');
    expect(suggested('Calla lily')).toBe('alcatraz');
  });

  it('plurali in spagnolo, inglese e italiano', () => {
    expect(suggested('Rosas rojas')).toBe('rosa');
    expect(suggested('Claveles')).toBe('clavel');
    expect(suggested('Alcatraces blancos')).toBe('alcatraz');
    expect(suggested('White lilies')).toBe('lilium');
    expect(suggested('Pink roses')).toBe('rosa');
    expect(suggested('Rose rosse')).toBe('rosa');
    expect(suggested('Garofani')).toBe('clavel');
    expect(suggested('Gigli bianchi')).toBe('lilium');
    expect(suggested('Girasoli')).toBe('girasol');
  });

  it('"rosa" e "lavanda" dopo un altro nome sono colori, non fiori', () => {
    expect(suggested('Pensamiento rosa')).toBeNull();
    expect(suggested('Flor lavanda')).toBeNull();
    expect(suggested('Lavanda')).toBe('lavanda');
    expect(suggested('Rosa lavanda')).toBe('rosa');
  });

  it('nessun suggerimento se il nome non nomina un fiore', () => {
    expect(suggested('Fiore 1')).toBeNull();
    expect(suggested('Rosado')).toBeNull();
    expect(suggested('')).toBeNull();
    // Solo fra le specie date (il modulo passa quelle del tipo di prodotto).
    expect(suggestSpecies('Rosa roja', [])).toBeNull();
  });

  it('il nome scientifico conta solo se nessun nome comune corrisponde', () => {
    expect(suggested('Dianthus caryophyllus')).toBe('clavel');
    expect(suggested('Helianthus annuus')).toBe('girasol');
  });
});

describe('nomi delle specie nei prompt e nel boceto', () => {
  it('plurale inglese con "of": birds of paradise', () => {
    expect(englishPlural('Bird of paradise')).toBe('Birds of paradise');
    expect(englishPlural('lily of the Nile')).toBe('lilies of the Nile');
    expect(englishPlural('rose')).toBe('roses');
  });

  it('le varianti mini non prendono la grandezza del fiore grande', () => {
    const size = (name: string, commonName: string | null = null) =>
      typicalBloomCm({ name, variety: null, commonName });
    expect(size('Mini rosa roja')).toBe(4);
    expect(size('Rosa roja', 'Spray rose')).toBe(4);
    expect(size('Rosa roja')).toBe(8);
    expect(size('Clavel spray')).toBe(4);
    expect(size('Garofanino')).toBe(4);
    expect(size('Clavel blanco')).toBe(6);
    expect(size('Mini gerbera')).toBe(6);
    expect(size('Gerbera')).toBe(10);
  });
});
