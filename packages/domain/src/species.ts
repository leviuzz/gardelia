/**
 * Specie della tassonomia globale (ADR-043) — regole pure.
 *
 *  - Ricerca nel campo Specie nella lingua di chi usa l'app: i fiori hanno nomi diversi in ogni
 *    lingua (clavel, garofano, carnation), quindi prima i nomi e i sinonimi di quella lingua,
 *    poi, più in basso, quelli delle altre lingue e il nome scientifico.
 *  - Specie suggerita dal nome del prodotto ("Rosa roja Freedom" → Rosa): qui contano tutte le
 *    lingue, perché il nome del prodotto è nella lingua della fioreria, non in quella di chi lo
 *    scrive. Vince la parola che viene prima nel nome ("Clavel rosa" è un garofano rosa, non una
 *    rosa); a parità, il nome più lungo ("Mini clavel" batte "Clavel").
 */
import { SUPPORTED_LOCALES, type SupportedLocale } from './i18n';

export type SpeciesCategory = 'CUT_FLOWER' | 'FOLIAGE' | 'PLANT';

/** Testo da confrontare: minuscole, senza accenti né punteggiatura, spazi singoli. */
export function normalizeSpeciesText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface SpeciesTerm {
  /** Come si mostra ("Nube", "Baby's breath"). */
  readonly text: string;
  /** Normalizzato per i confronti ("nube", "baby s breath"). */
  readonly key: string;
  /** Nome della specie in una lingua, sinonimo o nome scientifico. */
  readonly kind: 'name' | 'synonym' | 'scientific';
}

/** Una specie pronta per la ricerca, nella lingua di chi usa l'app. */
export interface SpeciesOption {
  readonly id: string;
  readonly category: SpeciesCategory;
  /** Nome nella lingua di chi usa l'app. */
  readonly name: string;
  readonly scientificName: string;
  /** Nome e sinonimi nella lingua di chi usa l'app. */
  readonly localTerms: readonly SpeciesTerm[];
  /** Nomi e sinonimi nelle altre lingue. */
  readonly otherTerms: readonly SpeciesTerm[];
  /**
   * Nome scientifico senza "spp." e simili. Conta per ultimo: più specie condividono il genere
   * (Rosa e Mini rosa, Clavel e Mini clavel).
   */
  readonly scientificTerm: SpeciesTerm | null;
}

/** Come arriva dal database (colonne `names` e `synonyms` in JSON). */
export interface SpeciesSource {
  readonly id: string;
  readonly category: SpeciesCategory;
  readonly scientificName: string;
  readonly names: unknown;
  readonly synonyms: unknown;
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parole del nome scientifico che non aiutano a cercare: "spp.", "var.", "×". */
const SCIENTIFIC_NOISE = new Set(['spp', 'sp', 'var', 'subsp', 'x', 'spray', 'mini']);

function scientificTerm(scientificName: string): SpeciesTerm | null {
  const text = scientificName.replace(/\(.*?\)/g, ' ').trim();
  const key = normalizeSpeciesText(text)
    .split(' ')
    .filter((word) => word && !SCIENTIFIC_NOISE.has(word))
    .join(' ');
  return key ? { text, key, kind: 'scientific' } : null;
}

function termsOf(
  texts: readonly { readonly text: string; readonly kind: 'name' | 'synonym' }[],
  seen: Set<string>,
): SpeciesTerm[] {
  const terms: SpeciesTerm[] = [];
  for (const { text, kind } of texts) {
    const key = normalizeSpeciesText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push({ text, key, kind });
  }
  return terms;
}

const asName = (text: string) => ({ text, kind: 'name' as const });
const asSynonym = (text: string) => ({ text, kind: 'synonym' as const });

/** Dalla riga del database alla specie da cercare nella lingua `locale`. */
export function speciesOption(source: SpeciesSource, locale: SupportedLocale): SpeciesOption {
  const names = recordOf(source.names);
  const synonyms = recordOf(source.synonyms);
  const name = stringsOf(names[locale])[0] ?? stringsOf(names['es-MX'])[0] ?? source.scientificName;
  const seen = new Set<string>();
  const localTerms = termsOf([asName(name), ...stringsOf(synonyms[locale]).map(asSynonym)], seen);
  const others = SUPPORTED_LOCALES.filter((other) => other !== locale).flatMap((other) => [
    ...stringsOf(names[other]).map(asName),
    ...stringsOf(synonyms[other]).map(asSynonym),
  ]);
  const otherTerms = termsOf(others, seen);
  const scientific = scientificTerm(source.scientificName);
  return {
    id: source.id,
    category: source.category,
    name,
    scientificName: source.scientificName,
    localTerms,
    otherTerms,
    scientificTerm: scientific && !seen.has(scientific.key) ? scientific : null,
  };
}

// -----------------------------------------------------------------------------
// Ricerca nel campo Specie
// -----------------------------------------------------------------------------

export interface SpeciesMatch {
  readonly option: SpeciesOption;
  /**
   * Il sinonimo o nome in un'altra lingua con cui è stata trovata, da mostrare accanto al nome
   * ("Nube (Gypsophila)" trovata scrivendo "paniculata"); null se è stata trovata dal nome o dal
   * nome scientifico (che si mostra comunque).
   */
  readonly matchedTerm: string | null;
}

/**
 * Quanto bene un termine corrisponde (più basso = meglio), o null: il nome che inizia con la
 * ricerca, poi un sinonimo che inizia con la ricerca, poi il nome con una parola che inizia con
 * la ricerca ("carnation" → "Spray carnation"). Dentro i sinonimi non si cerca a metà: "ro" non
 * deve trovare il ginger per il sinonimo "Ginger rojo".
 */
function termRank(term: SpeciesTerm, query: string): number | null {
  if (term.key.startsWith(query)) return term.kind === 'synonym' ? 1 : 0;
  return term.kind !== 'synonym' && term.key.includes(` ${query}`) ? 2 : null;
}

function bestRank(
  terms: readonly SpeciesTerm[],
  query: string,
  offset: number,
): { rank: number; term: SpeciesTerm } | null {
  let best: { rank: number; term: SpeciesTerm } | null = null;
  for (const term of terms) {
    const rank = termRank(term, query);
    if (rank === null) continue;
    if (!best || offset + rank < best.rank) best = { rank: offset + rank, term };
  }
  return best;
}

/**
 * Specie che corrispondono a quanto scritto, le migliori prima: nomi e sinonimi nella lingua di
 * chi usa l'app, poi quelli delle altre lingue, poi il nome scientifico; a parità, prima chi
 * corrisponde esattamente, poi in ordine alfabetico. Ricerca vuota: tutte, in ordine alfabetico.
 */
export function searchSpecies(
  query: string,
  options: readonly SpeciesOption[],
  locale: SupportedLocale,
): SpeciesMatch[] {
  const normalized = normalizeSpeciesText(query);
  const byName = (a: SpeciesOption, b: SpeciesOption) => a.name.localeCompare(b.name, locale);
  if (!normalized) {
    return [...options].sort(byName).map((option) => ({ option, matchedTerm: null }));
  }
  const ranked: { option: SpeciesOption; rank: number; exact: boolean; term: SpeciesTerm }[] = [];
  for (const option of options) {
    const scientific = option.scientificTerm ? [option.scientificTerm] : [];
    const found =
      bestRank(option.localTerms, normalized, 0) ??
      bestRank(option.otherTerms, normalized, 3) ??
      bestRank(scientific, normalized, 6);
    if (!found) continue;
    ranked.push({
      option,
      rank: found.rank,
      exact: found.term.key === normalized,
      term: found.term,
    });
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || Number(b.exact) - Number(a.exact) || byName(a.option, b.option),
  );
  return ranked.map(({ option, term }) => ({
    option,
    matchedTerm: term.kind === 'scientific' || term === option.localTerms[0] ? null : term.text,
  }));
}

// -----------------------------------------------------------------------------
// Specie suggerita dal nome del prodotto
// -----------------------------------------------------------------------------

/**
 * La parola del nome del prodotto è la parola del termine, anche al plurale: spagnolo e inglese
 * (rosas, claveles, alcatraces, lilies) e italiano (rose, garofani, gigli).
 */
function sameWord(word: string, term: string): boolean {
  if (word === term) return true;
  if (term.length < 3) return false;
  if (word === `${term}s` || word === `${term}es`) return true;
  const stem = term.slice(0, -1);
  const last = term.at(-1);
  if (last === 'z' && word === `${stem}ces`) return true;
  if (last === 'y' && word === `${stem}ies`) return true;
  if (last === 'a' && word === `${stem}e`) return true;
  if ((last === 'o' || last === 'e') && word === `${stem}i`) return true;
  return term.endsWith('io') && word === `${term.slice(0, -2)}i`;
}

/**
 * Colori che sono anche fiori. Spagnolo e italiano mettono il colore dopo il nome, quindi valgono
 * come specie solo se sono la prima parola: "Clavel rosa" è un garofano rosa, "Pensamiento rosa"
 * non è una rosa, "Rosa roja" sì.
 */
const COLOR_FLOWER_WORDS: ReadonlySet<string> = new Set(['rosa', 'lavanda']);

/** Prima posizione (in parole) in cui il termine compare nel nome, o -1. */
function positionIn(words: readonly string[], termWords: readonly string[]): number {
  for (let start = 0; start + termWords.length <= words.length; start++) {
    if (termWords.every((termWord, index) => sameWord(words[start + index]!, termWord))) {
      return start;
    }
  }
  return -1;
}

/**
 * Specie che il nome del prodotto indica, fra quelle date (già filtrate per tipo di prodotto),
 * o null se il nome non ne nomina nessuna ("Fiore 1"). Contano nomi e sinonimi in tutte le
 * lingue; il nome scientifico solo se nessun nome comune corrisponde.
 */
export function suggestSpecies(
  productName: string,
  options: readonly SpeciesOption[],
): SpeciesOption | null {
  const words = normalizeSpeciesText(productName).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const pick = (termsOf: (option: SpeciesOption) => readonly SpeciesTerm[]) => {
    let best: { option: SpeciesOption; position: number; length: number } | null = null;
    for (const option of options) {
      for (const term of termsOf(option)) {
        const termWords = term.key.split(' ');
        const position = positionIn(words, termWords);
        if (position < 0) continue;
        if (position > 0 && termWords.length === 1 && COLOR_FLOWER_WORDS.has(term.key)) continue;
        const better =
          !best ||
          position < best.position ||
          (position === best.position && termWords.length > best.length);
        if (better) best = { option, position, length: termWords.length };
      }
    }
    return best?.option ?? null;
  };
  return (
    pick((option) => [...option.localTerms, ...option.otherTerms]) ??
    pick((option) => (option.scientificTerm ? [option.scientificTerm] : []))
  );
}
