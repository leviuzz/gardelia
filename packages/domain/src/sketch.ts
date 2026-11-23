/**
 * Boceto esatto del ramo (ADR-028, ADR-034) — geometria pura e deterministica.
 *
 *  - Si costruisce dai ritagli delle foto del fiorista: UNA corolla per ogni stelo contato
 *    della distinta, quindi il numero di fiori è esatto per costruzione.
 *  - v2 (21/11/2026): come un ramo vero, corolle fitte a cupola (le esterne dietro, le centrali
 *    davanti), steli nascosti nella carta, angolazioni diverse dello stesso fiore alternate.
 *    La v1 (fiori sparsi su steli dritti) dava foto da collage. v3: proporzioni vere fra tipi
 *    di fiore (`typicalBloomCm`).
 *  - Stessa distinta → stesso boceto (generatore pseudo-casuale con seme dalla distinta).
 *  - Qui solo posizioni, misure e colori; il disegno vero (SVG + ritagli) lo fa il core.
 *  - Ogni corolla resta in gran parte visibile, così l'AI la mantiene e un modello di visione
 *    può contarla.
 */
import type { BouquetPreviewSpec, PreviewComponent } from './ai';
import type { CatalogColor } from './colors';

/** Cambiarla cambia il boceto, quindi anche la chiave di cache delle anteprime. */
export const SKETCH_LAYOUT_VERSION = 'sketch-v4';

/** Lato del boceto (px): quadrato come le immagini generate. */
export const SKETCH_SIZE = 1024;

/** Limiti del boceto: oltre, la composizione diventa illeggibile e il conteggio inaffidabile. */
export const SKETCH_LIMITS = {
  /** Steli contati (un fiore per stelo). */
  maxStems: 24,
  /** Rametti di follaje e di fiori di riempimento disegnati (indicativi, non contati). */
  maxFoliageSprigs: 8,
  maxFillerSprigs: 6,
} as const;

/** Tinte del boceto (le stesse dei campioni colore dell'interfaccia). */
export const SKETCH_COLOR_HEX: Readonly<Record<CatalogColor, string>> = {
  red: '#c0392b',
  pink: '#f2a7b9',
  fuchsia: '#c2185b',
  white: '#fdfdfb',
  cream: '#f3e9d2',
  yellow: '#f6c945',
  orange: '#ef8a3c',
  peach: '#f7c6a3',
  coral: '#f27d72',
  purple: '#7e57c2',
  lilac: '#c8a2e0',
  blue: '#5b8def',
  green: '#5f8f5a',
  burgundy: '#7b1e3a',
  multicolor: '#e9a8c0',
  black: '#262626',
  gold: '#c9a23f',
  silver: '#c4c8cc',
  brown: '#9a6b43',
  transparent: '#eef3f6',
};

const BACKGROUND = '#ebe6de';
const STEM_COLOR = '#4f7a3f';
const NEUTRAL_PAPER = '#e4dccd';
const KRAFT_PAPER = '#c49a6c';
const NEUTRAL_RIBBON = '#fdfdfb';

function hexOf(colors: readonly string[], fallback: string): string {
  for (const color of colors) {
    const hex = SKETCH_COLOR_HEX[color as CatalogColor];
    if (hex) return hex;
  }
  return fallback;
}

/** Carta senza colore in catalogo: la kraft si riconosce dal nome, le altre restano neutre. */
function paperHex(component: PreviewComponent): string {
  const fallback = /\bkraft\b/i.test(`${component.name} ${component.variety ?? ''}`)
    ? KRAFT_PAPER
    : NEUTRAL_PAPER;
  return hexOf(component.colors, fallback);
}

/** Scurisce un colore #rrggbb di una frazione (0–1): il foglio davanti si distingue. */
export function shadeHex(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 - amount))));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

/** Nastri, moños e legacci si disegnano come fiocco; gli altri complementi solo nel prompt. */
export function isRibbonLabel(label: string): boolean {
  return /\b(list[oó]n|listones|cinta|moños?|lazos?|ribbons?|bows?|organza|sat[eií]n|yute|rafia|cord[oó]n|mecate|twine)\b/i.test(
    label,
  );
}

/**
 * Diametro tipico della corolla (cm), riconosciuto dal nome comune o dal nome del catalogo
 * (spagnolo, inglese o italiano). Serve solo alle proporzioni del boceto: un girasole è grande
 * circa tre margherite. "rosa" va per ultima perché in spagnolo e in italiano è anche un colore
 * ("Tulipán rosa", "Tulipano rosa").
 */
const BLOOM_SIZE_CM: readonly (readonly [RegExp, number])[] = [
  // Varianti piccole prima dei fiori grandi con lo stesso nome (ADR-043).
  [/\b(spray rose|mini ?rosa|rosa (spray|mini|ramificata)|roselline)/, 4],
  [/\b(spray carnation|mini ?clavel|clavel (spray|mini)|garofanino|garofano (spray|mini))/, 4],
  [/\b(mini gerbera|gerbera mini|germini|gerberita)/, 6],
  [/\b(hortensia|hydrangea|ortensia)/, 18],
  [/\b(girasol|sunflower)/, 15],
  [/\b(lilium|lily|lilies|azucena|giglio|gigli)/, 14],
  [/\b(peonia|peony|peonies)/, 12],
  [/\bprotea/, 12],
  [/\b(gerbera|dalia|dahlia|anturio|anthurium)/, 10],
  [/\b(alcatraz|calla|orquidea|orchid)/, 8],
  [/\b(crisantemo|chrysanthemum|pompon)/, 7],
  [
    /\b(clavel|carnation|garofan|tulipan|tulip|lisianthus|eustoma|ranunculo|ranuncolo|ranunculus)/,
    6,
  ],
  [
    /\b(margarita|margherit|daisy|daisies|manzanilla|chamomile|camomilla|astromelia|alstroemeria)/,
    5,
  ],
  [/\b(rosa|rose|roses)\b/, 8],
];

export function typicalBloomCm(component: {
  readonly name: string;
  readonly variety: string | null;
  readonly commonName: string | null;
}): number | null {
  const text = `${component.commonName ?? ''} ${component.name} ${component.variety ?? ''}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  for (const [pattern, centimeters] of BLOOM_SIZE_CM) {
    if (pattern.test(text)) return centimeters;
  }
  return null;
}

/**
 * Grandezza relativa di ogni tipo di fiore nel ramo (media pesata sugli steli = 1). Tipi non
 * riconosciuti: grandezza media. Limiti 0,6–1,9 perché il boceto resti leggibile.
 */
export function relativeBloomSizes(flowers: readonly PreviewComponent[]): number[] {
  const known = flowers.map((flower) => typicalBloomCm(flower));
  let weight = 0;
  let total = 0;
  known.forEach((centimeters, index) => {
    if (centimeters === null) return;
    weight += flowers[index]!.quantity;
    total += centimeters * flowers[index]!.quantity;
  });
  if (weight === 0) return flowers.map(() => 1);
  const average = total / weight;
  return known.map((centimeters) => clamp((centimeters ?? average) / average, 0.6, 1.9));
}

/** Steli contati: fiori venduti a stelo (un fiore per stelo). */
export function countedFlowers(spec: BouquetPreviewSpec): PreviewComponent[] {
  return spec.components.filter(
    (component) => component.role === 'FLOWER' && component.saleUnit === 'STEM',
  );
}

// -----------------------------------------------------------------------------
// Pseudo-casuale deterministico
// -----------------------------------------------------------------------------

/** FNV-1a a 32 bit. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: piccolo, veloce e sufficiente per variare un disegno. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// -----------------------------------------------------------------------------
// Disposizione
// -----------------------------------------------------------------------------

export interface SketchPoint {
  readonly x: number;
  readonly y: number;
}

export interface SketchImagePlacement {
  readonly photoId: string;
  readonly catalogItemId: string;
  readonly kind: 'bloom' | 'filler' | 'foliage';
  /** Centro e misure del ritaglio (px); rotazione in gradi, in senso orario. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /** Ritaglio specchiato: con una sola foto per fiore, i fiori non sembrano tutti uguali. */
  readonly flip: boolean;
  /** Luminosità relativa (≈ 0,92–1,06): piccole differenze di luce fra fiori uguali. */
  readonly tone: number;
}

export interface SketchWrap {
  /** Foglio dietro i fiori e foglio davanti (copre gli steli), poligoni chiusi. */
  readonly back: readonly SketchPoint[];
  readonly front: readonly SketchPoint[];
  readonly backColor: string;
  readonly frontColor: string;
  /** Celofán: foglio semitrasparente. */
  readonly translucent: boolean;
}

export interface SketchLayout {
  readonly version: string;
  readonly size: number;
  readonly background: string;
  readonly stemColor: string;
  readonly stems: readonly { readonly from: SketchPoint; readonly to: SketchPoint }[];
  readonly stemWidth: number;
  readonly wrap: SketchWrap | null;
  readonly container: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: string;
  } | null;
  readonly ribbon: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly color: string;
  } | null;
  /** In ordine di disegno: follaje, riempimento, poi i fiori dall'esterno verso il centro. */
  readonly images: readonly SketchImagePlacement[];
}

export interface SketchLayoutInput {
  readonly spec: BouquetPreviewSpec;
  /** Proporzioni (larghezza / altezza) dei ritagli, per id della foto. */
  readonly cutoutAspects: Readonly<Record<string, number>>;
  /**
   * Quanto si allargano le corolle (0 = fitte come in un ramo vero, fino a
   * `SKETCH_CROWDING.levels - 1`). Il core prova i livelli finché ogni fiore resta visibile.
   */
  readonly crowding?: number;
}

/**
 * Boceto v4 (23/11/2026): un fiore coperto dagli altri sparisce anche dalla foto realistica e il
 * conteggio fallisce (caso del founder: 2 boccioli rosa dietro 3 rose rosse aperte). Il core misura
 * sulle forme vere dei ritagli quanta parte dei petali di ogni corolla resta visibile e, se non
 * basta, ridisegna con corolle un po' più piccole e più distanziate.
 */
export const SKETCH_CROWDING = {
  /** Livelli provati, dal più fitto al più arioso. */
  levels: 5,
  /** Parte dei petali di ogni corolla che deve restare visibile perché la si possa contare. */
  minVisible: 0.6,
  /** Per livello: corolle più piccole del 7% e distanza minima più grande. */
  shrinkPerLevel: 0.07,
  baseSpacing: 0.64,
  spacingPerLevel: 0.08,
} as const;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Misure del ritaglio a parità di area: le corolle con un po' di stelo non diventano minuscole. */
function fitBox(aspect: number, side: number): { width: number; height: number } {
  const ratio = clamp(Number.isFinite(aspect) && aspect > 0 ? aspect : 1, 0.35, 2.8);
  const width = clamp(side * Math.sqrt(ratio), side * 0.5, side * 1.6);
  const height = clamp(side / Math.sqrt(ratio), side * 0.5, side * 1.6);
  return { width, height };
}

/**
 * Ripartisce `total` posti fra i tipi in proporzione alle quantità, alternandoli (es. 3 rose +
 * 3 margherite → R M R M R M): ogni tipo resta distribuito su tutto il ramo.
 */
function interleave(quantities: readonly number[], total: number): number[] {
  const sum = quantities.reduce((acc, quantity) => acc + quantity, 0);
  const assigned = quantities.map(() => 0);
  const order: number[] = [];
  for (let slot = 0; slot < total; slot++) {
    let best = -1;
    let bestDeficit = -Infinity;
    quantities.forEach((quantity, index) => {
      if (assigned[index]! >= quantity) return;
      const deficit = (quantity * (slot + 1)) / sum - assigned[index]!;
      if (deficit > bestDeficit + 1e-9) {
        best = index;
        bestDeficit = deficit;
      }
    });
    if (best < 0) break;
    assigned[best]! += 1;
    order.push(best);
  }
  return order;
}

/** Posizioni delle corolle nella cupola (relative al centro), prima della variazione naturale. */
function domeSlots(count: number, radius: number, bloom: number, angle0: number) {
  if (count === 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    return [
      { x: -0.3 * bloom, y: -0.1 * bloom },
      { x: 0.32 * bloom, y: 0.12 * bloom },
    ];
  }
  if (count === 3) {
    return [
      { x: 0.05 * bloom, y: -0.42 * bloom },
      { x: -0.45 * bloom, y: 0.25 * bloom },
      { x: 0.5 * bloom, y: 0.22 * bloom },
    ];
  }
  // Spirale di Vogel in un disco, appena schiacciato: la cupola vista di fronte.
  const usable = radius - 0.45 * bloom;
  return Array.from({ length: count }, (_, index) => {
    const distance = Math.sqrt((index + 0.5) / count) * usable;
    const theta = angle0 + index * GOLDEN_ANGLE;
    return { x: distance * Math.cos(theta), y: distance * Math.sin(theta) * 0.86 };
  });
}

/**
 * Allontana le corolle troppo vicine (ognuna deve restare in gran parte visibile): la distanza
 * minima fra due corolle è `factor` × la media delle loro grandezze.
 */
function relax(points: { x: number; y: number }[], sizes: readonly number[], factor: number): void {
  for (let iteration = 0; iteration < 80; iteration++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const minDistance = (factor * (sizes[i]! + sizes[j]!)) / 2;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (distance < 1e-6) {
          // Coincidenti: direzione fissa e deterministica.
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const push = (minDistance - distance) / 2;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Seme dalla sola composizione (prodotti, quantità, colori, ritagli, stile). */
function layoutSeed(spec: BouquetPreviewSpec): number {
  return hashString(
    JSON.stringify([
      SKETCH_LAYOUT_VERSION,
      spec.style,
      spec.components.map((component) => [
        component.catalogItemId,
        component.quantity,
        component.colors,
        component.cutoutPhotoId,
        component.altCutoutPhotoIds,
      ]),
    ]),
  );
}

/** Ritagli di un componente: la foto principale (di frente) e le altre angolazioni. */
function cutoutsOf(component: PreviewComponent): string[] {
  return component.cutoutPhotoId ? [component.cutoutPhotoId, ...component.altCutoutPhotoIds] : [];
}

/**
 * Disposizione del boceto. Richiede un ritaglio per ogni fiore contato (vedi
 * `exactPreviewPlan`); follaje e fiori di riempimento senza ritaglio restano solo nel prompt.
 * Le proporzioni dei fiori sono quelle delle corolle (il core toglie gli steli dai ritagli).
 */
export function layoutBouquetSketch(input: SketchLayoutInput): SketchLayout {
  const { spec } = input;
  const size = SKETCH_SIZE;
  const random = seededRandom(layoutSeed(spec));
  const classic = spec.style === 'CLASSIC';
  const aspectOf = (photoId: string) => input.cutoutAspects[photoId] ?? 1;

  const flowers = countedFlowers(spec);
  for (const flower of flowers) {
    if (!flower.cutoutPhotoId) throw new Error(`ritaglio mancante: ${flower.catalogItemId}`);
  }
  const stems = flowers.reduce((sum, flower) => sum + flower.quantity, 0);
  if (stems < 1 || stems > SKETCH_LIMITS.maxStems) {
    throw new Error(`numero di steli fuori dai limiti del boceto: ${stems}`);
  }

  // Cupola: più steli, cupola più ampia e corolle più piccole, sempre fitte come in un ramo.
  const crowding = clamp(Math.round(input.crowding ?? 0), 0, SKETCH_CROWDING.levels - 1);
  const radius = clamp(150 + 55 * Math.sqrt(stems), 200, 380);
  const bloom =
    clamp(radius * 2 * Math.sqrt(0.9 / stems) * 1.12, 110, 300) *
    (1 - SKETCH_CROWDING.shrinkPerLevel * crowding);
  const cx = size / 2;
  const points = domeSlots(stems, radius, bloom, classic ? -Math.PI / 2 : random() * 2 * Math.PI);
  const jitter = classic ? 0.1 : 0.22;
  for (const point of points) {
    point.x += (random() - 0.5) * jitter * bloom;
    point.y += (random() - 0.5) * jitter * bloom;
  }

  // Proporzioni vere fra tipi (girasole > rosa > margherita), a parità di superficie totale.
  const relative = relativeBloomSizes(flowers);
  // Come fa un fiorista: i fiori più grandi al centro, i più piccoli intorno; a parità di
  // grandezza i tipi restano alternati. Ogni tipo usa le sue angolazioni a turno.
  const sequence = interleave(
    flowers.map((flower) => flower.quantity),
    stems,
  )
    .map((typeIndex, position) => ({ typeIndex, position }))
    .sort((a, b) => relative[b.typeIndex]! - relative[a.typeIndex]! || a.position - b.position)
    .map(({ typeIndex }) => typeIndex);
  const byDistance = points
    .map((point, slot) => ({ slot, distance: Math.hypot(point.x, point.y) }))
    .sort((a, b) => a.distance - b.distance || a.slot - b.slot);
  const order: number[] = new Array<number>(stems);
  byDistance.forEach(({ slot }, rank) => {
    order[slot] = sequence[rank]!;
  });
  const meanSquare =
    flowers.reduce((sum, flower, index) => sum + flower.quantity * relative[index]! ** 2, 0) /
    stems;
  const slotSizes = order.map(
    (typeIndex) => (bloom * relative[typeIndex]!) / Math.sqrt(meanSquare),
  );
  if (stems > 1) {
    relax(
      points,
      slotSizes,
      SKETCH_CROWDING.baseSpacing + SKETCH_CROWDING.spacingPerLevel * crowding,
    );
  }
  const turns = flowers.map(() => Math.floor(random() * 3));
  const farthest = Math.max(1, ...points.map((point) => Math.hypot(point.x, point.y)));
  const heads = points.map((point, slot) => {
    const typeIndex = order[slot]!;
    const flower = flowers[typeIndex]!;
    const variants = cutoutsOf(flower);
    const photoId = variants[turns[typeIndex]! % variants.length]!;
    turns[typeIndex]! += 1;
    const ring = Math.hypot(point.x, point.y) / farthest;
    // Le corolle esterne sono un po' più piccole e inclinate verso l'esterno (prospettiva).
    const side = slotSizes[slot]! * (1 - 0.14 * ring) * (0.94 + random() * 0.12);
    const box = fitBox(aspectOf(photoId), side);
    return {
      ring,
      placement: {
        photoId,
        catalogItemId: flower.catalogItemId,
        kind: 'bloom' as const,
        x: point.x,
        y: point.y,
        width: box.width,
        height: box.height,
        rotation:
          (point.x / farthest) * (classic ? 10 : 18) + (random() - 0.5) * (classic ? 8 : 16),
        flip: random() < 0.5,
        tone: 0.93 + random() * 0.12,
      },
    };
  });

  // Posizione verticale: tutto il ramo (cupola, carta, legatura, steli) centrato nel quadro.
  const foliage = spec.components.filter(
    (component) => component.role === 'FOLIAGE' && component.cutoutPhotoId,
  );
  const highest = Math.min(...heads.map(({ placement }) => placement.y - placement.height / 2));
  // La carta davanti scende sotto ogni corolla (piccola o grande): ne copre al massimo la base.
  const frontTopRel = Math.max(
    ...heads.map(({ placement }) => placement.y + 0.3 * placement.height),
  );
  const tieRel = frontTopRel + 0.2 * size;
  const top = highest - (foliage.length > 0 ? 0.35 * bloom : 0.05 * bloom);
  const bottom = tieRel + 0.11 * size;
  const cy = size / 2 - (top + bottom) / 2;
  const tie: SketchPoint = {
    x: cx + (classic ? 0 : (random() - 0.5) * 0.02 * size),
    y: cy + tieRel,
  };

  // Follaje con ritaglio: rametti intorno alla cupola, dietro i fiori, verso l'esterno.
  const sprigWanted = foliage.map((component) =>
    component.saleUnit === 'STEM' ? component.quantity * 2 : component.quantity * 4,
  );
  const sprigTotal = Math.min(
    SKETCH_LIMITS.maxFoliageSprigs,
    sprigWanted.reduce((sum, value) => sum + value, 0),
  );
  const sprigs: SketchImagePlacement[] = interleave(sprigWanted, sprigTotal).map(
    (componentIndex, index) => {
      const component = foliage[componentIndex]!;
      const variants = cutoutsOf(component);
      const photoId = variants[index % variants.length]!;
      const spread = sprigTotal === 1 ? 0.5 : index / (sprigTotal - 1);
      // Da sinistra (−170°) a destra (−10°) passando per l'alto.
      const angle = ((-170 + spread * 160 + (random() - 0.5) * 14) * Math.PI) / 180;
      const box = fitBox(aspectOf(photoId), bloom * 1.25);
      return {
        photoId,
        catalogItemId: component.catalogItemId,
        kind: 'foliage',
        x: cx + Math.cos(angle) * (farthest + bloom * 0.35),
        y: cy + Math.sin(angle) * (farthest * 0.86 + bloom * 0.3),
        width: box.width,
        height: box.height,
        rotation: (angle * 180) / Math.PI + 90 + (random() - 0.5) * 16,
        flip: random() < 0.5,
        tone: 0.95 + random() * 0.08,
      };
    },
  );

  // Fiori di riempimento (a mazzo) con ritaglio: piccoli, fra le corolle, dietro.
  const fillers = spec.components.filter(
    (component) =>
      component.role === 'FLOWER' && component.saleUnit !== 'STEM' && component.cutoutPhotoId,
  );
  const fillerWanted = fillers.map((component) => component.quantity * 3);
  const fillerTotal = Math.min(
    SKETCH_LIMITS.maxFillerSprigs,
    fillerWanted.reduce((sum, value) => sum + value, 0),
  );
  const fillerSprigs: SketchImagePlacement[] = interleave(fillerWanted, fillerTotal).map(
    (componentIndex, index) => {
      const component = fillers[componentIndex]!;
      const variants = cutoutsOf(component);
      const photoId = variants[index % variants.length]!;
      const angle = random() * 2 * Math.PI;
      const distance = farthest * (0.45 + random() * 0.6);
      const box = fitBox(aspectOf(photoId), bloom * 0.6);
      return {
        photoId,
        catalogItemId: component.catalogItemId,
        kind: 'filler',
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance * 0.86,
        width: box.width,
        height: box.height,
        rotation: (random() - 0.5) * 60,
        flip: random() < 0.5,
        tone: 0.95 + random() * 0.08,
      };
    },
  );

  // Carta (fino a due fogli: dietro e davanti) o contenitore (vaso, caja).
  const packaging = spec.components.filter((component) => component.role === 'PACKAGING');
  const containerItem = packaging.find((component) => component.itemType === 'CONTAINER');
  const papers = packaging.filter((component) => component.itemType !== 'CONTAINER');
  const halfWidth = farthest + 0.55 * bloom + 0.03 * size;

  let wrap: SketchWrap | null = null;
  let container: SketchLayout['container'] = null;
  if (containerItem) {
    const containerTop = cy + frontTopRel - 0.05 * size;
    container = {
      x: cx - halfWidth * 0.8,
      y: containerTop,
      width: halfWidth * 1.6,
      height: Math.min(0.3 * size, size * 0.97 - containerTop),
      color: hexOf(containerItem.colors, NEUTRAL_PAPER),
    };
  } else if (papers.length > 0) {
    const backColor = paperHex(papers[0]!);
    const frontColor = papers[1]
      ? paperHex(papers[1])
      : shadeHex(backColor, backColor === SKETCH_COLOR_HEX.black ? -0.25 : 0.07);
    const peak = () => (classic ? 0 : (random() - 0.5) * 0.04 * size);
    // Il foglio dietro sale ai lati della cupola; quello davanti copre steli e base delle corolle
    // più basse (mai i loro centri: restano contabili).
    const back: SketchPoint[] = [
      { x: tie.x - 0.03 * size, y: tie.y },
      { x: cx - halfWidth, y: cy + 0.1 * farthest },
      { x: cx - halfWidth * 0.95 + peak(), y: cy - farthest * 0.75 - 0.04 * size + peak() },
      { x: cx - halfWidth * 0.4, y: cy - farthest * 0.55 },
      { x: cx + halfWidth * 0.45, y: cy - farthest * 0.6 },
      { x: cx + halfWidth * 0.97 + peak(), y: cy - farthest * 0.8 - 0.06 * size + peak() },
      { x: cx + halfWidth, y: cy + 0.12 * farthest },
      { x: tie.x + 0.03 * size, y: tie.y },
      { x: tie.x + 0.02 * size, y: tie.y + 0.08 * size },
      { x: tie.x - 0.02 * size, y: tie.y + 0.08 * size },
    ];
    const tilt = classic ? 0 : (random() < 0.5 ? -1 : 1) * 0.03 * size;
    // Il bordo inclinato non sale mai sopra `frontTopRel` (boceto v4): prima, con l'inclinazione,
    // un angolo poteva coprire il centro delle corolle più basse.
    const frontTop = cy + frontTopRel + Math.abs(tilt) + 0.02 * size;
    const front: SketchPoint[] = [
      { x: cx - halfWidth * 0.92, y: frontTop + tilt - 0.02 * size },
      { x: cx - halfWidth * 0.2, y: frontTop + 0.01 * size },
      { x: cx + halfWidth * 0.92, y: frontTop - tilt - 0.02 * size },
      { x: tie.x + 0.03 * size, y: tie.y + 0.01 * size },
      { x: tie.x + 0.02 * size, y: tie.y + 0.08 * size },
      { x: tie.x - 0.02 * size, y: tie.y + 0.08 * size },
      { x: tie.x - 0.03 * size, y: tie.y + 0.01 * size },
    ];
    wrap = {
      back,
      front,
      backColor,
      frontColor,
      translucent: papers[0]!.colors.includes('transparent'),
    };
  }

  // Steli: senza carta né contenitore si vedono dalle corolle alla legatura; sempre le
  // estremità tagliate sotto la legatura (con il contenitore restano dentro).
  const stemLines: { from: SketchPoint; to: SketchPoint }[] = [];
  if (!wrap && !container) {
    for (const { placement } of heads) {
      stemLines.push({
        from: { x: cx + placement.x, y: cy + placement.y + placement.height * 0.2 },
        to: { x: tie.x + placement.x * 0.04, y: tie.y },
      });
    }
  }
  if (!container) {
    const ends = Math.min(stems, 10);
    for (let index = 0; index < ends; index++) {
      const offset = (index - (ends - 1) / 2) * 0.008 * size;
      stemLines.push({
        from: { x: tie.x + offset, y: tie.y },
        to: { x: tie.x + offset * 1.6, y: tie.y + 0.12 * size },
      });
    }
  }

  const ribbonItem = spec.components.find(
    (component) =>
      component.role === 'ACCESSORY' &&
      isRibbonLabel(`${component.name} ${component.variety ?? ''}`),
  );
  const ribbon = ribbonItem
    ? {
        x: container ? cx : tie.x,
        y: container ? container.y + 0.15 * size : tie.y,
        size: 0.1 * size,
        color: hexOf(ribbonItem.colors, NEUTRAL_RIBBON),
      }
    : null;

  // Ordine di disegno: dall'esterno verso il centro (le corolle centrali stanno davanti).
  const blooms = heads
    .sort((a, b) => b.ring - a.ring || a.placement.y - b.placement.y)
    .map(({ placement }) => ({ ...placement, x: cx + placement.x, y: cy + placement.y }));

  return {
    version: SKETCH_LAYOUT_VERSION,
    size,
    background: BACKGROUND,
    stemColor: STEM_COLOR,
    stems: stemLines,
    stemWidth: clamp(0.04 * bloom, 6, 12),
    wrap,
    container,
    ribbon,
    images: [...sprigs, ...fillerSprigs, ...blooms],
  };
}
