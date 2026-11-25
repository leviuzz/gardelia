/**
 * Dati di riferimento della piattaforma: servono in OGNI ambiente, produzione compresa, non solo
 * nella demo. Oggi è la tassonomia dei fiori: nomi comuni nelle anteprime, misure del boceto,
 * collegamento degli articoli del catalogo, ricerca della specie e specie suggerita dal nome del
 * prodotto (ADR-043).
 *
 * La fonte è questo file. `syncReferenceData` li allinea nel database a ogni rilascio, dopo le
 * migrazioni (`pnpm db:deploy`, build di produzione su Vercel), e prima dei test di
 * integrazione. È idempotente: inserisce i nuovi e riporta i valori di quelli esistenti a quelli
 * di questo file. Prima del 22/11/2026 la tassonomia la caricava solo il seed demo, che in
 * produzione non gira.
 *
 * Elenco (22/11/2026, ADR-043): specie vendute dalle fiorerie messicane, con i nomi usati in
 * Messico e i sinonimi per lingua. PROPOSTO dal team, DA VALIDARE con un fiorista (spec §19.6).
 * Il 25/11/2026 (ADR-085) si aggiungono 19 piante d'interno e i dati di cura delle piante in vaso
 * (luce, acqua, umidità, tossicità per cani e gatti dalla lista ASPCA): anche questi DA VALIDARE.
 * Gli slug esistenti non si tolgono né si rinominano: articoli e seed vi sono collegati.
 * I sinonimi servono alla ricerca e a riconoscere la specie dal nome del prodotto: ognuno deve
 * indicare una sola specie della stessa categoria (lo controlla il test dei dati di riferimento).
 */
import type {
  CatalogColor,
  PetToxicity,
  PetToxicitySource,
  PlantCare,
  PlantCareHumidity,
  PlantCareWatering,
  PlantLight,
  SupportedLocale,
} from '@floral/domain';
import type { DbClient } from './client';
import { Prisma } from './generated/prisma/client.ts';
import { withSystemContext, type TransactionClient } from './tenancy';

export interface CanonicalFlowerSeed {
  readonly slug: string;
  readonly scientificName: string;
  readonly category: 'CUT_FLOWER' | 'FOLIAGE' | 'PLANT';
  /** Nome mostrato in ogni lingua dell'interfaccia; l'inglese va anche nel prompt delle anteprime. */
  readonly names: Readonly<Record<SupportedLocale, string>>;
  /** Altri nomi con cui la si cerca o la si chiama nei prodotti, per lingua. */
  readonly synonyms: Readonly<Partial<Record<SupportedLocale, readonly string[]>>>;
  readonly colors: readonly CatalogColor[];
  /**
   * Solo per le piante in vaso (obbligatorio, lo controlla il test): luce, acqua, umidità e
   * tossicità per cani e gatti, per l'Asistente de plantas (ADR-085). DA VALIDARE con un fiorista.
   */
  readonly care?: PlantCare;
}

/**
 * I dati di cura di una pianta. La tossicità viene dalla lista ASPCA delle piante tossiche e non
 * tossiche per cani e gatti; `source: null` = da confermare (nessuna fonte certa). Nessun dato è
 * ancora rivisto da un fiorista (`reviewed: false`).
 */
function care(
  light: PlantLight,
  watering: PlantCareWatering,
  humidity: PlantCareHumidity,
  petToxicity: PetToxicity,
  toxicitySource: PetToxicitySource | null = 'ASPCA',
): PlantCare {
  return { light, watering, humidity, petToxicity, toxicitySource, reviewed: false };
}

// -----------------------------------------------------------------------------
// Fiori recisi
// -----------------------------------------------------------------------------

const CUT_FLOWERS: readonly CanonicalFlowerSeed[] = [
  {
    slug: 'rosa',
    scientificName: 'Rosa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Rosa', 'it-IT': 'Rosa', 'en-US': 'Rose' },
    synonyms: {},
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'peach', 'burgundy'],
  },
  {
    slug: 'rosa-spray',
    scientificName: 'Rosa spp. (spray)',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Mini rosa', 'it-IT': 'Rosa ramificata', 'en-US': 'Spray rose' },
    synonyms: {
      'es-MX': ['Rosa spray', 'Rosa mini', 'Minirosa'],
      'it-IT': ['Rosa spray', 'Roselline'],
      'en-US': ['Mini rose'],
    },
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'peach'],
  },
  {
    slug: 'tulipan',
    scientificName: 'Tulipa spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Tulipán', 'it-IT': 'Tulipano', 'en-US': 'Tulip' },
    synonyms: {},
    colors: ['red', 'pink', 'white', 'yellow', 'purple', 'orange'],
  },
  {
    slug: 'girasol',
    scientificName: 'Helianthus annuus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Girasol', 'it-IT': 'Girasole', 'en-US': 'Sunflower' },
    synonyms: {},
    colors: ['yellow'],
  },
  {
    slug: 'lilium',
    scientificName: 'Lilium spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Lilium', 'it-IT': 'Giglio', 'en-US': 'Lily' },
    synonyms: {
      'es-MX': ['Lili', 'Azucena'],
      'it-IT': ['Lilium'],
      'en-US': ['Lilium', 'Asiatic lily', 'Oriental lily'],
    },
    colors: ['white', 'pink', 'orange', 'yellow'],
  },
  {
    slug: 'gypsophila',
    scientificName: 'Gypsophila paniculata',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Nube (Gypsophila)', 'it-IT': 'Nebbiolina', 'en-US': "Baby's breath" },
    synonyms: {
      'es-MX': ['Nube', 'Gypsophila', 'Paniculata', 'Gipsofila'],
      'it-IT': ['Gypsophila', 'Gipsofila', 'Velo da sposa'],
      'en-US': ['Gypsophila'],
    },
    colors: ['white', 'pink'],
  },
  {
    slug: 'clavel',
    scientificName: 'Dianthus caryophyllus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Clavel', 'it-IT': 'Garofano', 'en-US': 'Carnation' },
    synonyms: { 'en-US': ['Dianthus'] },
    colors: ['red', 'pink', 'white', 'yellow', 'purple'],
  },
  {
    slug: 'clavel-mini',
    scientificName: 'Dianthus caryophyllus (spray)',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Mini clavel', 'it-IT': 'Garofanino', 'en-US': 'Spray carnation' },
    synonyms: {
      'es-MX': ['Clavel spray', 'Clavel mini', 'Miniclavel'],
      'it-IT': ['Garofano spray', 'Garofano mini'],
      'en-US': ['Mini carnation'],
    },
    colors: ['red', 'pink', 'white', 'yellow', 'purple', 'multicolor'],
  },
  {
    slug: 'hortensia',
    scientificName: 'Hydrangea macrophylla',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Hortensia', 'it-IT': 'Ortensia', 'en-US': 'Hydrangea' },
    synonyms: { 'es-MX': ['Hydrangea'], 'it-IT': ['Hydrangea'] },
    colors: ['blue', 'pink', 'white', 'purple'],
  },
  {
    slug: 'peonia',
    scientificName: 'Paeonia lactiflora',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Peonía', 'it-IT': 'Peonia', 'en-US': 'Peony' },
    synonyms: {},
    colors: ['pink', 'white', 'coral', 'burgundy'],
  },
  {
    slug: 'alstroemeria',
    scientificName: 'Alstroemeria spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Astromelia', 'it-IT': 'Alstroemeria', 'en-US': 'Peruvian lily' },
    synonyms: {
      'es-MX': ['Alstroemeria', 'Alstromelia', 'Alstromeria'],
      'it-IT': ['Astromelia', 'Giglio degli Inca'],
      'en-US': ['Alstroemeria'],
    },
    colors: ['pink', 'white', 'yellow', 'orange', 'purple'],
  },
  {
    slug: 'gerbera',
    scientificName: 'Gerbera jamesonii',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Gerbera', 'it-IT': 'Gerbera', 'en-US': 'Gerbera' },
    synonyms: { 'en-US': ['Gerbera daisy'] },
    colors: ['red', 'pink', 'orange', 'yellow', 'white'],
  },
  {
    slug: 'gerbera-mini',
    scientificName: 'Gerbera jamesonii (mini)',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Mini gerbera', 'it-IT': 'Gerbera mini', 'en-US': 'Mini gerbera' },
    synonyms: {
      'es-MX': ['Gerberita', 'Germini', 'Gerbera mini'],
      'it-IT': ['Germini', 'Mini gerbera'],
      'en-US': ['Germini'],
    },
    colors: ['red', 'pink', 'orange', 'yellow', 'white'],
  },
  {
    slug: 'crisantemo',
    scientificName: 'Chrysanthemum × morifolium',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Crisantemo', 'it-IT': 'Crisantemo', 'en-US': 'Chrysanthemum' },
    synonyms: {
      'es-MX': ['Pompón', 'Pompon'],
      'it-IT': ['Pompon'],
      'en-US': ['Mum', 'Pompon'],
    },
    colors: ['white', 'yellow', 'pink', 'purple', 'orange', 'green', 'burgundy'],
  },
  {
    slug: 'margarita',
    scientificName: 'Leucanthemum × superbum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Margarita', 'it-IT': 'Margherita', 'en-US': 'Daisy' },
    synonyms: { 'en-US': ['Shasta daisy'] },
    colors: ['white', 'yellow'],
  },
  {
    slug: 'lisianthus',
    scientificName: 'Eustoma grandiflorum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Lisianthus', 'it-IT': 'Lisianthus', 'en-US': 'Lisianthus' },
    synonyms: {
      'es-MX': ['Lisiantus', 'Eustoma'],
      'it-IT': ['Eustoma'],
      'en-US': ['Eustoma', 'Prairie gentian'],
    },
    colors: ['white', 'purple', 'pink', 'lilac', 'cream', 'green'],
  },
  {
    slug: 'statice',
    scientificName: 'Limonium sinuatum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Statice', 'it-IT': 'Statice', 'en-US': 'Statice' },
    synonyms: {
      'es-MX': ['Limonium'],
      'it-IT': ['Limonio', 'Limonium'],
      'en-US': ['Limonium', 'Sea lavender'],
    },
    colors: ['purple', 'blue', 'white', 'pink', 'yellow'],
  },
  {
    slug: 'aster',
    scientificName: 'Callistephus chinensis',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Áster', 'it-IT': 'Aster', 'en-US': 'Aster' },
    synonyms: {
      'es-MX': ['Matsumoto', 'Áster matsumoto'],
      'it-IT': ['Astro della Cina'],
      'en-US': ['China aster', 'Matsumoto aster'],
    },
    colors: ['purple', 'pink', 'white', 'lilac'],
  },
  {
    slug: 'solidago',
    scientificName: 'Solidago spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Solidago', 'it-IT': 'Solidago', 'en-US': 'Goldenrod' },
    synonyms: {
      'es-MX': ['Vara de oro'],
      'it-IT': ["Verga d'oro"],
      'en-US': ['Solidago'],
    },
    colors: ['yellow'],
  },
  {
    slug: 'ave-del-paraiso',
    scientificName: 'Strelitzia reginae',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Ave del paraíso', 'it-IT': 'Sterlizia', 'en-US': 'Bird of paradise' },
    synonyms: {
      'es-MX': ['Strelitzia', 'Estrelitzia'],
      'it-IT': ['Strelitzia', 'Uccello del paradiso'],
      'en-US': ['Strelitzia'],
    },
    colors: ['orange', 'blue'],
  },
  {
    slug: 'anturio',
    scientificName: 'Anthurium andraeanum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Anturio', 'it-IT': 'Anthurium', 'en-US': 'Anthurium' },
    synonyms: {
      'es-MX': ['Anthurium'],
      'it-IT': ['Anturio'],
      'en-US': ['Flamingo flower'],
    },
    colors: ['red', 'pink', 'white', 'green', 'burgundy'],
  },
  {
    slug: 'alcatraz',
    scientificName: 'Zantedeschia aethiopica',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Alcatraz', 'it-IT': 'Calla', 'en-US': 'Calla lily' },
    synonyms: {
      'es-MX': ['Cala', 'Calla', 'Cartucho'],
      'it-IT': ['Zantedeschia'],
      'en-US': ['Calla', 'Arum lily'],
    },
    colors: ['white', 'yellow', 'pink', 'purple', 'orange', 'burgundy'],
  },
  {
    slug: 'nardo',
    scientificName: 'Polianthes tuberosa',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Nardo', 'it-IT': 'Tuberosa', 'en-US': 'Tuberose' },
    synonyms: {
      'es-MX': ['Tuberosa'],
      'it-IT': ['Polianthes'],
      'en-US': ['Polianthes'],
    },
    colors: ['white'],
  },
  {
    slug: 'cempasuchil',
    scientificName: 'Tagetes erecta',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Cempasúchil', 'it-IT': 'Tagete', 'en-US': 'Marigold' },
    synonyms: {
      'es-MX': ['Cempasúchitl', 'Cempoalxóchitl', 'Flor de muerto', 'Tagetes'],
      'it-IT': ['Tagetes'],
      'en-US': ['Mexican marigold', 'Aztec marigold', 'Tagetes'],
    },
    colors: ['orange', 'yellow'],
  },
  {
    slug: 'alheli',
    scientificName: 'Matthiola incana',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Alhelí', 'it-IT': 'Violacciocca', 'en-US': 'Stock' },
    synonyms: {
      'es-MX': ['Matthiola'],
      'it-IT': ['Matthiola'],
      'en-US': ['Matthiola', 'Stock flower'],
    },
    colors: ['white', 'pink', 'purple', 'lilac', 'cream'],
  },
  {
    slug: 'gladiola',
    scientificName: 'Gladiolus spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Gladiola', 'it-IT': 'Gladiolo', 'en-US': 'Gladiolus' },
    synonyms: {
      'es-MX': ['Gladiolo', 'Gladiolus'],
      'it-IT': ['Gladiolus'],
      'en-US': ['Gladiola', 'Gladioli'],
    },
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'purple'],
  },
  {
    slug: 'iris',
    scientificName: 'Iris spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Iris', 'it-IT': 'Iris', 'en-US': 'Iris' },
    synonyms: { 'it-IT': ['Giaggiolo'] },
    colors: ['blue', 'purple', 'white', 'yellow'],
  },
  {
    slug: 'fresia',
    scientificName: 'Freesia spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Fresia', 'it-IT': 'Fresia', 'en-US': 'Freesia' },
    synonyms: { 'es-MX': ['Freesia'], 'it-IT': ['Freesia'] },
    colors: ['white', 'yellow', 'pink', 'purple', 'red', 'orange'],
  },
  {
    slug: 'ranunculo',
    scientificName: 'Ranunculus asiaticus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Ranúnculo', 'it-IT': 'Ranuncolo', 'en-US': 'Ranunculus' },
    synonyms: { 'es-MX': ['Ranunculus'], 'it-IT': ['Ranunculus'] },
    colors: ['white', 'pink', 'red', 'orange', 'yellow', 'peach', 'burgundy'],
  },
  {
    slug: 'anemona',
    scientificName: 'Anemone coronaria',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Anémona', 'it-IT': 'Anemone', 'en-US': 'Anemone' },
    synonyms: { 'es-MX': ['Anemone'] },
    colors: ['white', 'red', 'purple', 'blue', 'pink'],
  },
  {
    slug: 'delphinium',
    scientificName: 'Delphinium spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Delphinium', 'it-IT': 'Delphinium', 'en-US': 'Delphinium' },
    synonyms: {
      'es-MX': ['Espuela de caballero', 'Delfinio'],
      'it-IT': ['Speronella', 'Delfinio'],
      'en-US': ['Larkspur'],
    },
    colors: ['blue', 'purple', 'white', 'pink'],
  },
  {
    slug: 'perrito',
    scientificName: 'Antirrhinum majus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Perrito', 'it-IT': 'Bocca di leone', 'en-US': 'Snapdragon' },
    synonyms: {
      'es-MX': ['Boca de dragón', 'Antirrhinum'],
      'it-IT': ['Antirrhinum'],
      'en-US': ['Antirrhinum'],
    },
    colors: ['white', 'pink', 'yellow', 'orange', 'red', 'purple'],
  },
  {
    slug: 'dalia',
    scientificName: 'Dahlia spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Dalia', 'it-IT': 'Dalia', 'en-US': 'Dahlia' },
    synonyms: { 'es-MX': ['Dahlia'], 'it-IT': ['Dahlia'] },
    colors: ['red', 'pink', 'white', 'yellow', 'orange', 'purple', 'burgundy', 'peach'],
  },
  {
    slug: 'orquidea-dendrobium',
    scientificName: 'Dendrobium spp.',
    category: 'CUT_FLOWER',
    names: {
      'es-MX': 'Orquídea Dendrobium',
      'it-IT': 'Orchidea Dendrobium',
      'en-US': 'Dendrobium orchid',
    },
    synonyms: { 'es-MX': ['Dendrobium'], 'it-IT': ['Dendrobium'], 'en-US': ['Dendrobium'] },
    colors: ['white', 'purple', 'pink', 'green'],
  },
  {
    slug: 'orquidea-cymbidium',
    scientificName: 'Cymbidium spp.',
    category: 'CUT_FLOWER',
    names: {
      'es-MX': 'Orquídea Cymbidium',
      'it-IT': 'Orchidea Cymbidium',
      'en-US': 'Cymbidium orchid',
    },
    synonyms: { 'es-MX': ['Cymbidium'], 'it-IT': ['Cymbidium'], 'en-US': ['Cymbidium'] },
    colors: ['white', 'green', 'pink', 'yellow', 'burgundy'],
  },
  {
    slug: 'protea',
    scientificName: 'Protea spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Protea', 'it-IT': 'Protea', 'en-US': 'Protea' },
    synonyms: { 'en-US': ['King protea'] },
    colors: ['pink', 'white', 'cream'],
  },
  {
    slug: 'heliconia',
    scientificName: 'Heliconia spp.',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Heliconia', 'it-IT': 'Heliconia', 'en-US': 'Heliconia' },
    synonyms: {
      'es-MX': ['Platanillo'],
      'it-IT': ['Eliconia'],
      'en-US': ['Lobster claw'],
    },
    colors: ['red', 'orange', 'yellow'],
  },
  {
    slug: 'ginger',
    scientificName: 'Alpinia purpurata',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Ginger', 'it-IT': 'Alpinia', 'en-US': 'Red ginger' },
    synonyms: {
      'es-MX': ['Alpinia', 'Ginger rojo', 'Jengibre rojo'],
      'it-IT': ['Ginger'],
      'en-US': ['Ginger', 'Alpinia'],
    },
    colors: ['red', 'pink'],
  },
  {
    slug: 'agapando',
    scientificName: 'Agapanthus africanus',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Agapando', 'it-IT': 'Agapanto', 'en-US': 'Agapanthus' },
    synonyms: {
      'es-MX': ['Agapanto', 'Agapanthus'],
      'it-IT': ['Agapanthus'],
      'en-US': ['Lily of the Nile', 'African lily'],
    },
    colors: ['blue', 'purple', 'white'],
  },
  {
    slug: 'hypericum',
    scientificName: 'Hypericum androsaemum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Hypericum', 'it-IT': 'Iperico', 'en-US': 'Hypericum' },
    synonyms: { 'es-MX': ['Hipérico'], 'it-IT': ['Hypericum'] },
    colors: ['red', 'green', 'peach', 'burgundy'],
  },
  {
    slug: 'craspedia',
    scientificName: 'Craspedia globosa',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Craspedia', 'it-IT': 'Craspedia', 'en-US': 'Craspedia' },
    synonyms: { 'en-US': ['Billy buttons', 'Billy balls'] },
    colors: ['yellow'],
  },
  {
    slug: 'celosia',
    scientificName: 'Celosia argentea',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Celosia', 'it-IT': 'Celosia', 'en-US': 'Celosia' },
    synonyms: {
      'es-MX': ['Cresta de gallo'],
      'it-IT': ['Cresta di gallo'],
      'en-US': ['Cockscomb'],
    },
    colors: ['red', 'orange', 'yellow', 'pink', 'burgundy'],
  },
  {
    slug: 'lavanda',
    scientificName: 'Lavandula angustifolia',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Lavanda', 'it-IT': 'Lavanda', 'en-US': 'Lavender' },
    synonyms: { 'es-MX': ['Lavandula'], 'it-IT': ['Lavandula'], 'en-US': ['Lavandula'] },
    colors: ['purple', 'lilac'],
  },
  {
    slug: 'flor-de-cera',
    scientificName: 'Chamelaucium uncinatum',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Flor de cera', 'it-IT': 'Fiore di cera', 'en-US': 'Waxflower' },
    synonyms: {
      'es-MX': ['Chamelaucium'],
      'it-IT': ['Chamelaucium'],
      'en-US': ['Wax flower', 'Chamelaucium'],
    },
    colors: ['white', 'pink', 'purple'],
  },
  {
    slug: 'gardenia',
    scientificName: 'Gardenia jasminoides',
    category: 'CUT_FLOWER',
    names: { 'es-MX': 'Gardenia', 'it-IT': 'Gardenia', 'en-US': 'Gardenia' },
    synonyms: {},
    colors: ['white', 'cream'],
  },
];

// -----------------------------------------------------------------------------
// Fogliame
// -----------------------------------------------------------------------------

const FOLIAGE: readonly CanonicalFlowerSeed[] = [
  {
    slug: 'eucalipto',
    scientificName: 'Eucalyptus spp.',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Eucalipto', 'it-IT': 'Eucalipto', 'en-US': 'Eucalyptus' },
    synonyms: {},
    colors: ['green'],
  },
  {
    slug: 'ruscus',
    scientificName: 'Ruscus hypophyllum',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Ruscus', 'it-IT': 'Ruscus', 'en-US': 'Ruscus' },
    synonyms: { 'it-IT': ['Rusco'], 'en-US': ['Italian ruscus'] },
    colors: ['green'],
  },
  {
    slug: 'helecho',
    scientificName: 'Rumohra adiantiformis',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Helecho', 'it-IT': 'Felce', 'en-US': 'Leatherleaf fern' },
    synonyms: {
      'es-MX': ['Helecho cuero', 'Helecho leather', 'Leather'],
      'it-IT': ['Felce leather'],
      'en-US': ['Leather fern', 'Fern'],
    },
    colors: ['green'],
  },
  {
    slug: 'pittosporum',
    scientificName: 'Pittosporum tenuifolium',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Pittosporum', 'it-IT': 'Pittosporo', 'en-US': 'Pittosporum' },
    synonyms: { 'es-MX': ['Pitosporo'], 'it-IT': ['Pittosporum'] },
    colors: ['green'],
  },
  {
    slug: 'aralia',
    scientificName: 'Fatsia japonica',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Aralia', 'it-IT': 'Aralia', 'en-US': 'Fatsia' },
    synonyms: {
      'es-MX': ['Fatsia'],
      'it-IT': ['Fatsia'],
      'en-US': ['Aralia', 'Japanese aralia'],
    },
    colors: ['green'],
  },
  {
    slug: 'monstera-hoja',
    scientificName: 'Monstera deliciosa',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Hoja de monstera', 'it-IT': 'Foglia di monstera', 'en-US': 'Monstera leaf' },
    synonyms: { 'es-MX': ['Monstera'], 'it-IT': ['Monstera'], 'en-US': ['Monstera'] },
    colors: ['green'],
  },
  {
    slug: 'camedor',
    scientificName: 'Chamaedorea elegans',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Camedor', 'it-IT': 'Chamaedorea', 'en-US': 'Parlor palm' },
    synonyms: {
      'es-MX': ['Palma camedor', 'Chamaedorea', 'Palmilla'],
      'it-IT': ['Camedor'],
      'en-US': ['Chamaedorea'],
    },
    colors: ['green'],
  },
  {
    slug: 'esparrago',
    scientificName: 'Asparagus setaceus',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Espárrago plumoso', 'it-IT': 'Asparagina', 'en-US': 'Asparagus fern' },
    synonyms: {
      'es-MX': ['Espárrago', 'Plumoso', 'Asparagus'],
      'it-IT': ['Asparago', 'Asparagus'],
      'en-US': ['Asparagus'],
    },
    colors: ['green'],
  },
  {
    slug: 'hiedra',
    scientificName: 'Hedera helix',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Hiedra', 'it-IT': 'Edera', 'en-US': 'Ivy' },
    synonyms: { 'es-MX': ['Hedera'], 'it-IT': ['Hedera'], 'en-US': ['English ivy'] },
    colors: ['green'],
  },
  {
    slug: 'olivo',
    scientificName: 'Olea europaea',
    category: 'FOLIAGE',
    names: { 'es-MX': 'Olivo', 'it-IT': 'Ulivo', 'en-US': 'Olive branch' },
    synonyms: { 'es-MX': ['Rama de olivo'], 'it-IT': ['Olivo'], 'en-US': ['Olive'] },
    colors: ['green', 'silver'],
  },
];

// -----------------------------------------------------------------------------
// Piante
// -----------------------------------------------------------------------------

const PLANTS: readonly CanonicalFlowerSeed[] = [
  {
    slug: 'orquidea-phalaenopsis',
    scientificName: 'Phalaenopsis spp.',
    category: 'PLANT',
    names: {
      'es-MX': 'Orquídea Phalaenopsis',
      'it-IT': 'Orchidea Phalaenopsis',
      'en-US': 'Moth orchid',
    },
    synonyms: {
      'es-MX': ['Phalaenopsis', 'Orquídea mariposa'],
      'it-IT': ['Phalaenopsis', 'Falenopsis'],
      'en-US': ['Phalaenopsis'],
    },
    colors: ['white', 'purple', 'pink'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'HIGH', 'NON_TOXIC'),
  },
  {
    slug: 'monstera',
    scientificName: 'Monstera deliciosa',
    category: 'PLANT',
    names: { 'es-MX': 'Monstera', 'it-IT': 'Monstera', 'en-US': 'Monstera' },
    synonyms: { 'es-MX': ['Costilla de Adán'], 'en-US': ['Swiss cheese plant'] },
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'anturio-planta',
    scientificName: 'Anthurium andraeanum',
    category: 'PLANT',
    names: { 'es-MX': 'Anturio', 'it-IT': 'Anthurium', 'en-US': 'Anthurium' },
    synonyms: {
      'es-MX': ['Anthurium'],
      'it-IT': ['Anturio'],
      'en-US': ['Flamingo flower'],
    },
    colors: ['red', 'pink', 'white'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'HIGH', 'TOXIC'),
  },
  {
    slug: 'cuna-de-moises',
    scientificName: 'Spathiphyllum wallisii',
    category: 'PLANT',
    names: { 'es-MX': 'Cuna de Moisés', 'it-IT': 'Spatifillo', 'en-US': 'Peace lily' },
    synonyms: {
      'es-MX': ['Espatifilo', 'Spathiphyllum', 'Lirio de paz'],
      'it-IT': ['Spathiphyllum'],
      'en-US': ['Spathiphyllum'],
    },
    colors: ['white', 'green'],
    care: care('LOW', 'SLIGHTLY_MOIST', 'HIGH', 'TOXIC'),
  },
  {
    slug: 'nochebuena',
    scientificName: 'Euphorbia pulcherrima',
    category: 'PLANT',
    names: { 'es-MX': 'Nochebuena', 'it-IT': 'Stella di Natale', 'en-US': 'Poinsettia' },
    synonyms: {
      'es-MX': ['Flor de nochebuena', 'Poinsettia'],
      'it-IT': ['Poinsettia'],
    },
    colors: ['red', 'white', 'pink'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'MILD'),
  },
  {
    slug: 'suculenta',
    scientificName: 'Crassulaceae',
    category: 'PLANT',
    names: { 'es-MX': 'Suculenta', 'it-IT': 'Pianta grassa', 'en-US': 'Succulent' },
    synonyms: {
      'es-MX': ['Crasa', 'Echeveria'],
      'it-IT': ['Succulenta', 'Echeveria'],
      'en-US': ['Echeveria'],
    },
    colors: ['green'],
    care: care('HIGH', 'LITTLE', 'LOW', 'VARIES', null),
  },
  {
    slug: 'cactus',
    scientificName: 'Cactaceae',
    category: 'PLANT',
    names: { 'es-MX': 'Cactus', 'it-IT': 'Cactus', 'en-US': 'Cactus' },
    synonyms: { 'es-MX': ['Cacto'], 'it-IT': ['Cactacea'], 'en-US': ['Cacti'] },
    colors: ['green'],
    care: care('HIGH', 'LITTLE', 'LOW', 'VARIES', null),
  },
  {
    slug: 'lengua-de-suegra',
    scientificName: 'Dracaena trifasciata',
    category: 'PLANT',
    names: { 'es-MX': 'Lengua de suegra', 'it-IT': 'Sansevieria', 'en-US': 'Snake plant' },
    synonyms: {
      'es-MX': ['Sansevieria', 'Sanseviera'],
      'it-IT': ['Lingua di suocera'],
      'en-US': ['Sansevieria'],
    },
    colors: ['green'],
    care: care('LOW', 'LITTLE', 'LOW', 'TOXIC'),
  },
  {
    slug: 'telefono',
    scientificName: 'Epipremnum aureum',
    category: 'PLANT',
    names: { 'es-MX': 'Teléfono', 'it-IT': 'Pothos', 'en-US': 'Pothos' },
    synonyms: {
      'es-MX': ['Pothos', 'Potus', 'Poto'],
      'it-IT': ['Potos', 'Scindapsus'],
      'en-US': ["Devil's ivy", 'Epipremnum'],
    },
    colors: ['green'],
    care: care('LOW', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'kalanchoe',
    scientificName: 'Kalanchoe blossfeldiana',
    category: 'PLANT',
    names: { 'es-MX': 'Kalanchoe', 'it-IT': 'Kalanchoe', 'en-US': 'Kalanchoe' },
    synonyms: {},
    colors: ['red', 'orange', 'yellow', 'pink', 'white'],
    care: care('HIGH', 'LITTLE', 'LOW', 'TOXIC'),
  },
  {
    slug: 'bromelia',
    scientificName: 'Guzmania spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Bromelia', 'it-IT': 'Bromelia', 'en-US': 'Bromeliad' },
    synonyms: { 'es-MX': ['Guzmania'], 'it-IT': ['Guzmania'], 'en-US': ['Bromelia', 'Guzmania'] },
    colors: ['red', 'orange', 'yellow', 'pink'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'HIGH', 'NON_TOXIC'),
  },
  {
    slug: 'zamioculca',
    scientificName: 'Zamioculcas zamiifolia',
    category: 'PLANT',
    names: { 'es-MX': 'Zamioculca', 'it-IT': 'Zamioculcas', 'en-US': 'ZZ plant' },
    synonyms: {
      'es-MX': ['Zamioculcas', 'ZZ'],
      'it-IT': ['Zamioculca', 'ZZ'],
      'en-US': ['Zamioculcas'],
    },
    colors: ['green'],
    care: care('LOW', 'LITTLE', 'LOW', 'TOXIC', null),
  },
  {
    slug: 'ficus',
    scientificName: 'Ficus spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Ficus', 'it-IT': 'Ficus', 'en-US': 'Ficus' },
    synonyms: {},
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'helecho-boston',
    scientificName: 'Nephrolepis exaltata',
    category: 'PLANT',
    names: { 'es-MX': 'Helecho Boston', 'it-IT': 'Felce di Boston', 'en-US': 'Boston fern' },
    synonyms: {
      'es-MX': ['Helecho de Boston', 'Nephrolepis'],
      'it-IT': ['Nephrolepis', 'Nefrolepis'],
      'en-US': ['Nephrolepis'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'HIGH', 'NON_TOXIC'),
  },
  {
    slug: 'begonia',
    scientificName: 'Begonia spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Begonia', 'it-IT': 'Begonia', 'en-US': 'Begonia' },
    synonyms: {},
    colors: ['red', 'pink', 'white', 'orange', 'yellow'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'HIGH', 'TOXIC'),
  },
  {
    slug: 'violeta-africana',
    scientificName: 'Streptocarpus ionanthus',
    category: 'PLANT',
    names: {
      'es-MX': 'Violeta africana',
      'it-IT': 'Violetta africana',
      'en-US': 'African violet',
    },
    synonyms: { 'es-MX': ['Saintpaulia'], 'it-IT': ['Saintpaulia'], 'en-US': ['Saintpaulia'] },
    colors: ['purple', 'pink', 'white', 'blue'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'MEDIUM', 'NON_TOXIC'),
  },
  {
    slug: 'azalea',
    scientificName: 'Rhododendron simsii',
    category: 'PLANT',
    names: { 'es-MX': 'Azalea', 'it-IT': 'Azalea', 'en-US': 'Azalea' },
    synonyms: {},
    colors: ['pink', 'white', 'red', 'purple'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'HIGH', 'TOXIC'),
  },
  // Piante d'interno comuni in Messico (ADR-085, blocco 6): PROPOSTO, DA VALIDARE con un fiorista.
  {
    slug: 'palma-areca',
    scientificName: 'Dypsis lutescens',
    category: 'PLANT',
    names: { 'es-MX': 'Palma areca', 'it-IT': 'Palma Areca', 'en-US': 'Areca palm' },
    synonyms: {
      'es-MX': ['Areca', 'Palma de areca'],
      'it-IT': ['Areca', 'Crisalidocarpo'],
      'en-US': ['Butterfly palm', 'Golden cane palm'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'MEDIUM', 'NON_TOXIC'),
  },
  {
    slug: 'palma-camedor-planta',
    scientificName: 'Chamaedorea elegans',
    category: 'PLANT',
    names: { 'es-MX': 'Palma camedor', 'it-IT': 'Palma da salotto', 'en-US': 'Parlor palm' },
    synonyms: {
      'es-MX': ['Palma de salón', 'Chamaedorea'],
      'it-IT': ['Chamaedorea', 'Camedorea'],
      'en-US': ['Chamaedorea', 'Neanthe bella palm'],
    },
    colors: ['green'],
    care: care('LOW', 'DRY_BETWEEN', 'MEDIUM', 'NON_TOXIC'),
  },
  {
    slug: 'palo-de-brasil',
    scientificName: 'Dracaena fragrans',
    category: 'PLANT',
    names: {
      'es-MX': 'Palo de Brasil',
      'it-IT': 'Tronchetto della felicità',
      'en-US': 'Corn plant',
    },
    synonyms: {
      'es-MX': ['Tronco de Brasil', 'Palo de agua', 'Dracena fragrans'],
      'it-IT': ['Dracena fragrans', 'Dracaena fragrans'],
      'en-US': ['Dracaena fragrans', 'Happy plant'],
    },
    colors: ['green'],
    care: care('LOW', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'dracena-marginata',
    scientificName: 'Dracaena marginata',
    category: 'PLANT',
    names: { 'es-MX': 'Dracena marginata', 'it-IT': 'Dracena marginata', 'en-US': 'Dragon tree' },
    synonyms: {
      'es-MX': ['Dracaena marginata', 'Dragón de Madagascar'],
      'it-IT': ['Dracaena marginata'],
      'en-US': ['Madagascar dragon tree', 'Dracaena marginata'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'calathea',
    scientificName: 'Goeppertia spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Calathea', 'it-IT': 'Calathea', 'en-US': 'Calathea' },
    synonyms: {
      'es-MX': ['Calatea', 'Goeppertia'],
      'it-IT': ['Calatea', 'Goeppertia'],
      'en-US': ['Goeppertia'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'SLIGHTLY_MOIST', 'HIGH', 'NON_TOXIC'),
  },
  {
    slug: 'aglaonema',
    scientificName: 'Aglaonema spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Aglaonema', 'it-IT': 'Aglaonema', 'en-US': 'Chinese evergreen' },
    synonyms: {
      'es-MX': ['Aglonema', 'Siempreverde chino'],
      'it-IT': ['Aglonema'],
      'en-US': ['Aglaonema'],
    },
    colors: ['green', 'pink', 'red'],
    care: care('LOW', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'filodendro',
    scientificName: 'Philodendron spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Filodendro', 'it-IT': 'Filodendro', 'en-US': 'Philodendron' },
    synonyms: {
      'es-MX': ['Philodendron'],
      'it-IT': ['Philodendron'],
      'en-US': ['Heartleaf philodendron'],
    },
    colors: ['green'],
    care: care('LOW', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'peperomia',
    scientificName: 'Peperomia spp.',
    category: 'PLANT',
    names: { 'es-MX': 'Peperomia', 'it-IT': 'Peperomia', 'en-US': 'Peperomia' },
    synonyms: {
      'es-MX': ['Peperonia'],
      'en-US': ['Baby rubber plant', 'Radiator plant'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'NON_TOXIC'),
  },
  {
    slug: 'mala-madre',
    scientificName: 'Chlorophytum comosum',
    category: 'PLANT',
    names: { 'es-MX': 'Mala madre', 'it-IT': 'Falangio', 'en-US': 'Spider plant' },
    synonyms: {
      'es-MX': ['Malamadre', 'Cinta', 'Lazo de amor', 'Chlorophytum'],
      'it-IT': ['Clorofito', 'Chlorophytum', 'Nastrino'],
      'en-US': ['Chlorophytum', 'Airplane plant'],
    },
    colors: ['green', 'white'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'NON_TOXIC'),
  },
  {
    slug: 'cheflera',
    scientificName: 'Schefflera arboricola',
    category: 'PLANT',
    names: { 'es-MX': 'Cheflera', 'it-IT': 'Schefflera', 'en-US': 'Umbrella tree' },
    synonyms: {
      'es-MX': ['Schefflera', 'Chefflera', 'Árbol paraguas'],
      'it-IT': ['Albero ombrello'],
      'en-US': ['Schefflera', 'Dwarf umbrella tree'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'croton',
    scientificName: 'Codiaeum variegatum',
    category: 'PLANT',
    names: { 'es-MX': 'Crotón', 'it-IT': 'Croton', 'en-US': 'Croton' },
    synonyms: {
      'es-MX': ['Croto', 'Codiaeum'],
      'it-IT': ['Crotone', 'Codiaeum'],
      'en-US': ['Garden croton', 'Codiaeum'],
    },
    colors: ['green', 'yellow', 'red', 'orange', 'multicolor'],
    care: care('HIGH', 'SLIGHTLY_MOIST', 'HIGH', 'TOXIC'),
  },
  {
    slug: 'diefenbaquia',
    scientificName: 'Dieffenbachia seguine',
    category: 'PLANT',
    names: { 'es-MX': 'Diefenbaquia', 'it-IT': 'Dieffenbachia', 'en-US': 'Dumb cane' },
    synonyms: {
      'es-MX': ['Dieffenbachia', 'Difenbaquia'],
      'it-IT': ['Diffenbachia'],
      'en-US': ['Dieffenbachia'],
    },
    colors: ['green', 'white'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'sabila',
    scientificName: 'Aloe vera',
    category: 'PLANT',
    names: { 'es-MX': 'Sábila', 'it-IT': 'Aloe vera', 'en-US': 'Aloe vera' },
    synonyms: {
      'es-MX': ['Aloe vera', 'Áloe', 'Zábila'],
      'it-IT': ['Aloe'],
      'en-US': ['Aloe'],
    },
    colors: ['green'],
    care: care('HIGH', 'LITTLE', 'LOW', 'TOXIC'),
  },
  {
    slug: 'singonio',
    scientificName: 'Syngonium podophyllum',
    category: 'PLANT',
    names: { 'es-MX': 'Singonio', 'it-IT': 'Syngonium', 'en-US': 'Arrowhead plant' },
    synonyms: {
      'es-MX': ['Syngonium', 'Singonium'],
      'it-IT': ['Singonio'],
      'en-US': ['Syngonium', 'Arrowhead vine'],
    },
    colors: ['green', 'pink'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'pata-de-elefante',
    scientificName: 'Beaucarnea recurvata',
    category: 'PLANT',
    names: { 'es-MX': 'Pata de elefante', 'it-IT': 'Beaucarnea', 'en-US': 'Ponytail palm' },
    synonyms: {
      'es-MX': ['Beaucarnea', 'Nolina', 'Palma pata de elefante'],
      'it-IT': ['Nolina', "Piede d'elefante"],
      'en-US': ['Beaucarnea', "Elephant's foot"],
    },
    colors: ['green'],
    care: care('HIGH', 'LITTLE', 'LOW', 'NON_TOXIC'),
  },
  {
    slug: 'hule',
    scientificName: 'Ficus elastica',
    category: 'PLANT',
    names: { 'es-MX': 'Hule', 'it-IT': 'Ficus elastica', 'en-US': 'Rubber plant' },
    synonyms: {
      'es-MX': ['Ficus elastica', 'Árbol del caucho', 'Gomero'],
      'it-IT': ['Albero della gomma'],
      'en-US': ['Rubber tree', 'Ficus elastica'],
    },
    colors: ['green', 'burgundy'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'ficus-lira',
    scientificName: 'Ficus lyrata',
    category: 'PLANT',
    names: { 'es-MX': 'Ficus lira', 'it-IT': 'Ficus lyrata', 'en-US': 'Fiddle-leaf fig' },
    synonyms: {
      'es-MX': ['Ficus lyrata', 'Higuera hoja de violín'],
      'it-IT': ['Ficus lira'],
      'en-US': ['Ficus lyrata', 'Fiddle leaf fig'],
    },
    colors: ['green'],
    care: care('MEDIUM', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
  {
    slug: 'yuca',
    scientificName: 'Yucca elephantipes',
    category: 'PLANT',
    names: { 'es-MX': 'Yuca', 'it-IT': 'Yucca', 'en-US': 'Yucca' },
    synonyms: {
      'es-MX': ['Izote', 'Yucca'],
      'it-IT': ['Yuca'],
      'en-US': ['Spineless yucca', 'Yucca cane'],
    },
    colors: ['green'],
    care: care('HIGH', 'LITTLE', 'LOW', 'TOXIC'),
  },
  {
    slug: 'ave-del-paraiso-planta',
    scientificName: 'Strelitzia reginae',
    category: 'PLANT',
    names: { 'es-MX': 'Ave del paraíso', 'it-IT': 'Sterlizia', 'en-US': 'Bird of paradise' },
    synonyms: {
      'es-MX': ['Strelitzia', 'Estrelitzia'],
      'it-IT': ['Strelitzia', 'Uccello del paradiso'],
      'en-US': ['Strelitzia'],
    },
    colors: ['orange', 'blue'],
    care: care('HIGH', 'DRY_BETWEEN', 'MEDIUM', 'TOXIC'),
  },
];

export const CANONICAL_FLOWERS: readonly CanonicalFlowerSeed[] = [
  ...CUT_FLOWERS,
  ...FOLIAGE,
  ...PLANTS,
];

/** Inserisce o aggiorna la tassonomia in una transazione già in contesto di sistema. */
export async function upsertCanonicalFlowers(tx: TransactionClient): Promise<number> {
  for (const flower of CANONICAL_FLOWERS) {
    const data = {
      scientificName: flower.scientificName,
      category: flower.category,
      names: flower.names,
      synonyms: flower.synonyms,
      colors: [...flower.colors],
      care: flower.care ?? Prisma.DbNull,
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
