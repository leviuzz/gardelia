/**
 * Boceto esatto del ramo (ADR-028, ADR-034) — geometria pura e deterministica.
 *
 *  - Si costruisce dai ritagli delle foto del fiorista: UN ritaglio per ogni stelo contato
 *    della distinta, quindi il numero di fiori è esatto per costruzione.
 *  - Stessa distinta → stesso boceto (generatore pseudo-casuale con seme dalla distinta).
 *  - Qui solo posizioni, misure e colori; il disegno vero (SVG + ritagli) lo fa il core.
 *  - I fiori restano ben separati e interi, così l'AI li mantiene e un modello di visione
 *    può contarli.
 */
import type { BouquetPreviewSpec, PreviewComponent } from './ai';
import type { CatalogColor } from './colors';

/** Cambiarla cambia il boceto, quindi anche la chiave di cache delle anteprime. */
export const SKETCH_LAYOUT_VERSION = 'sketch-v1';

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
  /** In ordine di disegno: follaje, riempimento, poi i fiori dall'alto verso il basso. */
  readonly images: readonly SketchImagePlacement[];
}

export interface SketchLayoutInput {
  readonly spec: BouquetPreviewSpec;
  /** Proporzioni (larghezza / altezza) dei ritagli, per id della foto. */
  readonly cutoutAspects: Readonly<Record<string, number>>;
}

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

/** Posizioni dei fiori nella cupola (relative al centro), prima della variazione naturale. */
function domeSlots(count: number, rx: number, ry: number, bloom: number, angle0: number) {
  if (count === 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    return [
      { x: -0.42 * rx, y: 0 },
      { x: 0.42 * rx, y: 0 },
    ];
  }
  if (count === 3) {
    return [
      { x: 0, y: -0.4 * ry },
      { x: -0.46 * rx, y: 0.24 * ry },
      { x: 0.46 * rx, y: 0.24 * ry },
    ];
  }
  // Spirale di Vogel: distribuzione uniforme e naturale per qualsiasi numero.
  const usableX = rx - 0.42 * bloom;
  const usableY = ry - 0.42 * bloom;
  return Array.from({ length: count }, (_, index) => {
    const radius = Math.sqrt((index + 0.5) / count);
    const theta = angle0 + index * GOLDEN_ANGLE;
    return { x: radius * usableX * Math.cos(theta), y: radius * usableY * Math.sin(theta) };
  });
}

/** Allontana i fiori troppo vicini (ognuno deve restare ben visibile) restando nella cupola. */
function relax(
  points: { x: number; y: number }[],
  minDistance: number,
  rx: number,
  ry: number,
): void {
  for (let iteration = 0; iteration < 60; iteration++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
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
    for (const point of points) {
      const outside = (point.x / rx) ** 2 + (point.y / ry) ** 2;
      if (outside > 1) {
        const scale = 1 / Math.sqrt(outside);
        point.x *= scale;
        point.y *= scale;
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
      ]),
    ]),
  );
}

/**
 * Disposizione del boceto. Richiede un ritaglio per ogni fiore contato (vedi
 * `exactPreviewPlan`); follaje e fiori di riempimento senza ritaglio restano solo nel prompt.
 */
export function layoutBouquetSketch(input: SketchLayoutInput): SketchLayout {
  const { spec } = input;
  const size = SKETCH_SIZE;
  const random = seededRandom(layoutSeed(spec));
  const natural = spec.style !== 'CLASSIC';
  const aspectOf = (photoId: string) => input.cutoutAspects[photoId] ?? 1;

  const flowers = countedFlowers(spec);
  for (const flower of flowers) {
    if (!flower.cutoutPhotoId) throw new Error(`ritaglio mancante: ${flower.catalogItemId}`);
  }
  const stems = flowers.reduce((sum, flower) => sum + flower.quantity, 0);
  if (stems < 1 || stems > SKETCH_LIMITS.maxStems) {
    throw new Error(`numero di steli fuori dai limiti del boceto: ${stems}`);
  }

  // Cupola dei fiori: più steli, cupola più ampia e fiori più piccoli.
  const rx = clamp((0.2 + 0.035 * Math.sqrt(stems)) * size, 0.22 * size, 0.34 * size);
  const ry = rx * (natural ? 0.74 : 0.82);
  const bloom = clamp(2 * Math.sqrt((0.95 * rx * ry) / stems), 0.1 * size, 0.3 * size);
  const cx = size / 2;
  const cy = size / 2 - (0.32 * size - 0.65 * bloom) / 2;

  const points = domeSlots(stems, rx, ry, bloom, natural ? random() * 2 * Math.PI : -Math.PI / 2);
  if (natural) {
    for (const point of points) {
      // Altezze e distanze leggermente diverse, come in un ramo fatto a mano.
      point.x += (random() - 0.5) * 0.3 * bloom;
      point.y += (random() - 0.5) * 0.3 * bloom;
    }
  }
  if (stems > 1) relax(points, 0.76 * bloom, rx, ry);

  const order = interleave(
    flowers.map((flower) => flower.quantity),
    stems,
  );
  const blooms: SketchImagePlacement[] = points.map((point, slot) => {
    const flower = flowers[order[slot]!]!;
    const photoId = flower.cutoutPhotoId!;
    const side = bloom * (natural ? 0.92 + random() * 0.16 : 1);
    const box = fitBox(aspectOf(photoId), side);
    return {
      photoId,
      catalogItemId: flower.catalogItemId,
      kind: 'bloom',
      x: cx + point.x,
      y: cy + point.y,
      width: box.width,
      height: box.height,
      rotation: (random() - 0.5) * (natural ? 36 : 10),
      flip: natural ? random() < 0.5 : slot % 2 === 1,
    };
  });

  // Follaje con ritaglio: rametti sul bordo superiore della cupola, verso l'esterno.
  const foliage = spec.components.filter(
    (component) => component.role === 'FOLIAGE' && component.cutoutPhotoId,
  );
  const sprigWanted = foliage.map((component) =>
    component.saleUnit === 'STEM' ? component.quantity : component.quantity * 3,
  );
  const sprigTotal = Math.min(
    SKETCH_LIMITS.maxFoliageSprigs,
    sprigWanted.reduce((sum, value) => sum + value, 0),
  );
  const sprigOrder = interleave(sprigWanted, sprigTotal);
  const sprigs: SketchImagePlacement[] = sprigOrder.map((componentIndex, index) => {
    const component = foliage[componentIndex]!;
    const photoId = component.cutoutPhotoId!;
    const spread = sprigTotal === 1 ? 0.5 : index / (sprigTotal - 1);
    // Da sinistra (−165°) a destra (−15°) passando per l'alto, con piccole variazioni.
    const angle = ((-165 + spread * 150 + (random() - 0.5) * 14) * Math.PI) / 180;
    const box = fitBox(aspectOf(photoId), bloom * 1.15);
    return {
      photoId,
      catalogItemId: component.catalogItemId,
      kind: 'foliage',
      x: cx + Math.cos(angle) * rx * 0.94,
      y: cy + Math.sin(angle) * ry * 0.94,
      width: box.width,
      height: box.height,
      rotation: (angle * 180) / Math.PI + 90 + (random() - 0.5) * 16,
      flip: random() < 0.5,
    };
  });

  // Fiori di riempimento (a mazzo) con ritaglio: piccoli, fra i fiori, dietro.
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
    (componentIndex) => {
      const component = fillers[componentIndex]!;
      const photoId = component.cutoutPhotoId!;
      const angle = random() * 2 * Math.PI;
      const radius = 0.35 + random() * 0.6;
      const box = fitBox(aspectOf(photoId), bloom * 0.7);
      return {
        photoId,
        catalogItemId: component.catalogItemId,
        kind: 'filler',
        x: cx + Math.cos(angle) * rx * radius,
        y: cy + Math.sin(angle) * ry * radius,
        width: box.width,
        height: box.height,
        rotation: (random() - 0.5) * 60,
        flip: random() < 0.5,
      };
    },
  );

  // Carta (fino a due fogli: dietro e davanti) o contenitore (vaso, caja).
  const packaging = spec.components.filter((component) => component.role === 'PACKAGING');
  const containerItem = packaging.find((component) => component.itemType === 'CONTAINER');
  const papers = packaging.filter((component) => component.itemType !== 'CONTAINER');
  const tie: SketchPoint = {
    x: cx + (natural ? (random() - 0.5) * 0.03 * size : 0),
    y: cy + ry + 0.2 * size,
  };
  const lowestBloom = Math.max(...blooms.map((placement) => placement.y + placement.height / 2));

  let wrap: SketchWrap | null = null;
  let container: SketchLayout['container'] = null;
  if (containerItem) {
    const top = Math.min(cy + ry * 0.45, lowestBloom - 0.25 * bloom);
    const height = Math.min(0.3 * size, size * 0.97 - top);
    container = {
      x: cx - rx * 0.9,
      y: top,
      width: rx * 1.8,
      height,
      color: hexOf(containerItem.colors, NEUTRAL_PAPER),
    };
  } else if (papers.length > 0) {
    const backColor = paperHex(papers[0]!);
    const frontColor = papers[1]
      ? paperHex(papers[1])
      : shadeHex(backColor, backColor === SKETCH_COLOR_HEX.black ? -0.25 : 0.07);
    const jitter = () => (natural ? (random() - 0.5) * 0.05 * size : 0);
    const half = rx + 0.05 * size;
    const back: SketchPoint[] = [
      { x: tie.x - 0.035 * size, y: tie.y },
      { x: cx - half, y: cy + 0.05 * ry },
      { x: cx - half * 0.92 + jitter(), y: cy - ry * 0.55 - 0.05 * size + jitter() },
      { x: cx - half * 0.45, y: cy - ry * 0.75 },
      { x: cx + jitter(), y: cy - ry - 0.02 * size },
      { x: cx + half * 0.45, y: cy - ry * 0.8 },
      { x: cx + half * 0.95 + jitter(), y: cy - ry * 0.55 - 0.08 * size + jitter() },
      { x: cx + half, y: cy + 0.08 * ry },
      { x: tie.x + 0.035 * size, y: tie.y },
      { x: tie.x + 0.022 * size, y: tie.y + 0.09 * size },
      { x: tie.x - 0.022 * size, y: tie.y + 0.09 * size },
    ];
    // Il foglio davanti copre gli steli e appena il bordo dei fiori più bassi.
    const frontTop = lowestBloom - 0.1 * bloom;
    const tilt = natural ? (random() < 0.5 ? -1 : 1) * 0.035 * size : 0;
    const front: SketchPoint[] = [
      { x: cx - rx * 0.98, y: frontTop + tilt },
      { x: cx + rx * 0.98, y: frontTop - tilt },
      { x: tie.x + 0.03 * size, y: tie.y + 0.01 * size },
      { x: tie.x + 0.022 * size, y: tie.y + 0.09 * size },
      { x: tie.x - 0.022 * size, y: tie.y + 0.09 * size },
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

  // Steli: da ogni fiore al punto di legatura; sotto, le estremità tagliate.
  const stemLines: { from: SketchPoint; to: SketchPoint }[] = blooms.map((placement) => ({
    from: { x: placement.x, y: placement.y + placement.height * 0.15 },
    to: container
      ? { x: placement.x * 0.4 + cx * 0.6, y: container.y + 0.05 * size }
      : { x: tie.x + (placement.x - cx) * 0.04, y: tie.y },
  }));
  if (!container) {
    const ends = Math.min(stems, 10);
    for (let index = 0; index < ends; index++) {
      const offset = (index - (ends - 1) / 2) * 0.009 * size;
      stemLines.push({
        from: { x: tie.x + offset, y: tie.y },
        to: { x: tie.x + offset * 1.7, y: tie.y + 0.14 * size },
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
        y: container ? container.y + 0.18 * size : tie.y,
        size: 0.11 * size,
        color: hexOf(ribbonItem.colors, NEUTRAL_RIBBON),
      }
    : null;

  return {
    version: SKETCH_LAYOUT_VERSION,
    size,
    background: BACKGROUND,
    stemColor: STEM_COLOR,
    stems: stemLines,
    stemWidth: clamp(0.045 * bloom, 6, 14),
    wrap,
    container,
    ribbon,
    images: [...sprigs, ...fillerSprigs, ...[...blooms].sort((a, b) => a.y - b.y || a.x - b.x)],
  };
}
