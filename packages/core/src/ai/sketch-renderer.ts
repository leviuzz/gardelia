/**
 * Disegno del boceto esatto (ADR-034): la geometria viene da `layoutBouquetSketch` (dominio,
 * deterministica); qui si disegnano carta, steli, contenitore e fiocco in SVG e si compongono
 * i ritagli delle foto del fiorista con sharp. Nessuna rete, nessun costo.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { bloomHeadFor } from './bloom-head';
import {
  SKETCH_CROWDING,
  colorNameOf,
  countedFlowers,
  layoutBouquetSketch,
  shadeHex,
  type BouquetPreviewSpec,
  type SketchLayout,
  type SketchPoint,
} from '@floral/domain';

const svgNumber = (value: number) => Math.round(value * 10) / 10;

function polygon(points: readonly SketchPoint[]): string {
  return points.map((point) => `${svgNumber(point.x)},${svgNumber(point.y)}`).join(' ');
}

/** Il colore arriva dal vocabolario del dominio, ma si ricontrolla prima di metterlo in SVG. */
function safeColor(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#cccccc';
}

function backLayer(layout: SketchLayout): string {
  const parts: string[] = [];
  const { wrap, container } = layout;
  if (wrap) {
    const fill = wrap.translucent ? '#ffffff' : safeColor(wrap.backColor);
    const stroke = wrap.translucent ? '#b9c6cf' : shadeHex(safeColor(wrap.backColor), 0.22);
    parts.push(
      `<polygon points="${polygon(wrap.back)}" fill="${fill}" fill-opacity="${wrap.translucent ? 0.45 : 1}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
    );
    // Pieghe della carta: linee leggere dal punto di legatura verso le punte.
    const tie = wrap.back[0]!;
    for (const peak of [wrap.back[2], wrap.back[4], wrap.back[6]]) {
      if (!peak) continue;
      parts.push(
        `<line x1="${svgNumber(tie.x + 18)}" y1="${svgNumber(tie.y)}" x2="${svgNumber(peak.x)}" y2="${svgNumber(peak.y)}" stroke="${stroke}" stroke-opacity="0.35" stroke-width="2"/>`,
      );
    }
  }
  for (const stem of layout.stems) {
    parts.push(
      `<line x1="${svgNumber(stem.from.x)}" y1="${svgNumber(stem.from.y)}" x2="${svgNumber(stem.to.x)}" y2="${svgNumber(stem.to.y)}" stroke="${safeColor(layout.stemColor)}" stroke-width="${svgNumber(layout.stemWidth)}" stroke-linecap="round"/>`,
    );
  }
  if (container) {
    const color = safeColor(container.color);
    parts.push(
      `<rect x="${svgNumber(container.x)}" y="${svgNumber(container.y)}" width="${svgNumber(container.width)}" height="${svgNumber(container.height)}" rx="${svgNumber(container.width * 0.06)}" fill="${color}" stroke="${shadeHex(color, 0.25)}" stroke-width="3"/>`,
    );
  }
  return svgDocument(layout, parts);
}

function bow(ribbon: NonNullable<SketchLayout['ribbon']>): string {
  const s = ribbon.size;
  const color = safeColor(ribbon.color);
  const stroke = shadeHex(color, color.toLowerCase() === '#fdfdfb' ? 0.2 : 0.3);
  const n = svgNumber;
  return [
    `<g transform="translate(${n(ribbon.x)},${n(ribbon.y)})" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" fill="${color}">`,
    `<path d="M${n(-0.06 * s)},${n(0.06 * s)} L${n(-0.34 * s)},${n(0.62 * s)} L${n(-0.2 * s)},${n(0.66 * s)} L${n(0.01 * s)},${n(0.12 * s)} Z"/>`,
    `<path d="M${n(0.06 * s)},${n(0.06 * s)} L${n(0.3 * s)},${n(0.64 * s)} L${n(0.17 * s)},${n(0.67 * s)} L${n(-0.01 * s)},${n(0.12 * s)} Z"/>`,
    `<ellipse cx="${n(-0.3 * s)}" cy="${n(-0.04 * s)}" rx="${n(0.32 * s)}" ry="${n(0.17 * s)}" transform="rotate(-18 ${n(-0.3 * s)} ${n(-0.04 * s)})"/>`,
    `<ellipse cx="${n(0.3 * s)}" cy="${n(-0.04 * s)}" rx="${n(0.32 * s)}" ry="${n(0.17 * s)}" transform="rotate(18 ${n(0.3 * s)} ${n(-0.04 * s)})"/>`,
    `<circle cx="0" cy="0" r="${n(0.09 * s)}"/>`,
    '</g>',
  ].join('');
}

function frontLayer(layout: SketchLayout): string {
  const parts: string[] = [];
  const { wrap } = layout;
  if (wrap) {
    const fill = wrap.translucent ? '#ffffff' : safeColor(wrap.frontColor);
    const stroke = wrap.translucent ? '#b9c6cf' : shadeHex(safeColor(wrap.frontColor), 0.22);
    parts.push(
      `<polygon points="${polygon(wrap.front)}" fill="${fill}" fill-opacity="${wrap.translucent ? 0.4 : 1}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
    );
    const [left, right, tie] = wrap.front;
    if (left && right && tie) {
      // Una piega diagonale sul foglio davanti.
      parts.push(
        `<line x1="${svgNumber((left.x + right.x) / 2)}" y1="${svgNumber((left.y + right.y) / 2)}" x2="${svgNumber(tie.x)}" y2="${svgNumber(tie.y)}" stroke="${stroke}" stroke-opacity="0.35" stroke-width="2"/>`,
      );
    }
  }
  if (layout.ribbon) parts.push(bow(layout.ribbon));
  return svgDocument(layout, parts);
}

function svgDocument(layout: SketchLayout, parts: readonly string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.size}" height="${layout.size}" viewBox="0 0 ${layout.size} ${layout.size}">${parts.join('')}</svg>`;
}

/** Ritaglio ridimensionato e ruotato, tagliato ai bordi del quadro se serve. */
async function placedImage(
  layout: SketchLayout,
  cutout: Uint8Array,
  placement: SketchLayout['images'][number],
): Promise<OverlayOptions | null> {
  const width = Math.max(8, Math.round(placement.width));
  const height = Math.max(8, Math.round(placement.height));
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .resize(width, height, { fit: 'contain', background: transparent })
    .modulate({ brightness: placement.tone })
    .flop(placement.flip)
    .rotate(placement.rotation, { background: transparent })
    .png()
    .toBuffer({ resolveWithObject: true });
  let left = Math.round(placement.x - info.width / 2);
  let top = Math.round(placement.y - info.height / 2);
  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const visibleWidth = Math.min(info.width - cropLeft, layout.size - Math.max(0, left));
  const visibleHeight = Math.min(info.height - cropTop, layout.size - Math.max(0, top));
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  let input: Buffer = data;
  if (cropLeft > 0 || cropTop > 0 || visibleWidth < info.width || visibleHeight < info.height) {
    input = await sharp(data)
      .extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight })
      .png()
      .toBuffer();
    left = Math.max(0, left);
    top = Math.max(0, top);
  }
  return { input, left, top };
}

/** Disegna una disposizione già calcolata con i ritagli indicati (PNG). */
export async function renderSketch(
  layout: SketchLayout,
  cutouts: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const overlays: OverlayOptions[] = [{ input: Buffer.from(backLayer(layout)), left: 0, top: 0 }];
  for (const placement of layout.images) {
    const cutout = cutouts.get(placement.photoId);
    if (!cutout) throw new Error(`ritaglio non caricato: ${placement.photoId}`);
    const overlay = await placedImage(layout, cutout, placement);
    if (overlay) overlays.push(overlay);
  }
  overlays.push({ input: Buffer.from(frontLayer(layout)), left: 0, top: 0 });
  const png = await sharp({
    create: { width: layout.size, height: layout.size, channels: 3, background: layout.background },
  })
    .composite(overlays)
    .png({ compressionLevel: 8 })
    .toBuffer();
  return new Uint8Array(png);
}

/** La visibilità si misura su un quadro a 1/4 del boceto: veloce e abbastanza preciso. */
const VISIBILITY_SCALE = 0.25;

/** Verde di foglie e sepali: non è un petalo (un fiore nascosto con le foglie fuori non si conta). */
function isFoliageGreen(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  if (max < 40 || max - Math.min(r, g, b) < 25) return false;
  return g === max && g - r > 12 && g - b > 8;
}

interface PlacedMask {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** 1 = pixel pieno del ritaglio (copre ciò che sta sotto). */
  readonly opaque: Uint8Array;
  /** 1 = petalo: pieno e non verde; per un fiore quasi tutto verde, tutto il pieno. */
  readonly petals: Uint8Array;
}

/** Maschera di un ritaglio con le stesse trasformazioni del disegno (misura, specchio, rotazione). */
async function placedMask(
  cutout: Uint8Array,
  placement: SketchLayout['images'][number],
  scale: number,
): Promise<PlacedMask> {
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .resize(
      Math.max(2, Math.round(placement.width * scale)),
      Math.max(2, Math.round(placement.height * scale)),
      { fit: 'contain', background: transparent },
    )
    .flop(placement.flip)
    .rotate(placement.rotation, { background: transparent })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const opaque = new Uint8Array(pixels);
  const petals = new Uint8Array(pixels);
  let opaqueCount = 0;
  let petalCount = 0;
  for (let index = 0; index < pixels; index++) {
    const offset = index * info.channels;
    if ((data[offset + 3] ?? 0) < 128) continue;
    opaque[index] = 1;
    opaqueCount += 1;
    if (!isFoliageGreen(data[offset]!, data[offset + 1]!, data[offset + 2]!)) {
      petals[index] = 1;
      petalCount += 1;
    }
  }
  if (petalCount < opaqueCount * 0.15) petals.set(opaque);
  return {
    left: Math.round(placement.x * scale - info.width / 2),
    top: Math.round(placement.y * scale - info.height / 2),
    width: info.width,
    height: info.height,
    opaque,
    petals,
  };
}

/**
 * Quanta parte dei petali di ogni corolla resta visibile nel boceto (0–1), nell'ordine delle
 * corolle in `layout.images` (boceto v4). Si dipingono le corolle nell'ordine di disegno e per
 * ognuna si contano i suoi petali rimasti in cima; fuori dal quadro conta come nascosto. Carta e
 * follaje non contano: la carta davanti copre al massimo la base delle corolle più basse.
 */
export async function bloomVisibility(
  layout: SketchLayout,
  cutouts: ReadonlyMap<string, Uint8Array>,
): Promise<number[]> {
  const side = Math.round(layout.size * VISIBILITY_SCALE);
  const blooms = layout.images.filter((image) => image.kind === 'bloom');
  const masks = await Promise.all(
    blooms.map((bloom) => {
      const cutout = cutouts.get(bloom.photoId);
      if (!cutout) throw new Error(`ritaglio non caricato: ${bloom.photoId}`);
      return placedMask(cutout, bloom, VISIBILITY_SCALE);
    }),
  );
  const owner = new Int16Array(side * side).fill(-1);
  masks.forEach((mask, index) => {
    for (let y = 0; y < mask.height; y++) {
      const row = mask.top + y;
      if (row < 0 || row >= side) continue;
      for (let x = 0; x < mask.width; x++) {
        const column = mask.left + x;
        if (column < 0 || column >= side || !mask.opaque[y * mask.width + x]) continue;
        owner[row * side + column] = index;
      }
    }
  });
  return masks.map((mask, index) => {
    let total = 0;
    let visible = 0;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (!mask.petals[y * mask.width + x]) continue;
        total += 1;
        const row = mask.top + y;
        const column = mask.left + x;
        if (row >= 0 && row < side && column >= 0 && column < side) {
          if (owner[row * side + column] === index) visible += 1;
        }
      }
    }
    return total === 0 ? 1 : visible / total;
  });
}

/**
 * Colore dei petali di un ritaglio (media dei pixel pieni e non verdi), nel vocabolario del
 * catalogo. Serve a descrivere il fiore al controllo dei conteggi quando il catalogo non dice il
 * colore (ADR-034, 23/11). null se la foto non ha abbastanza petali o il colore è indistinto.
 */
export async function petalColorOf(png: Uint8Array): Promise<string | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .resize(96, 96, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if ((data[offset + 3] ?? 0) < 128) continue;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    if (isFoliageGreen(r, g, b)) continue;
    red += r;
    green += g;
    blue += b;
    count += 1;
  }
  return count < 20 ? null : colorNameOf(red / count, green / count, blue / count);
}

/** Foto scontornate che il boceto userà (fiori contati, riempimento e follaje con ritaglio). */
export function sketchPhotoIds(spec: BouquetPreviewSpec): string[] {
  const ids = new Set<string>();
  for (const flower of countedFlowers(spec)) {
    if (flower.cutoutPhotoId) ids.add(flower.cutoutPhotoId);
  }
  for (const component of spec.components) {
    if ((component.role === 'FLOWER' || component.role === 'FOLIAGE') && component.cutoutPhotoId) {
      ids.add(component.cutoutPhotoId);
      for (const id of component.altCutoutPhotoIds) ids.add(id);
    }
  }
  return [...ids];
}

/** Foto dei fiori (non del follaje): nel boceto se ne usa solo la corolla. */
function flowerPhotoIds(spec: BouquetPreviewSpec): Set<string> {
  const ids = new Set<string>();
  for (const component of spec.components) {
    if (component.role !== 'FLOWER' || !component.cutoutPhotoId) continue;
    ids.add(component.cutoutPhotoId);
    for (const id of component.altCutoutPhotoIds) ids.add(id);
  }
  return ids;
}

/**
 * Boceto completo di una distinta: carica i ritagli (miniature PNG con trasparenza), ne legge le
 * proporzioni, calcola la disposizione e la disegna. Boceto v4: se una corolla resta troppo
 * coperta dalle altre, si riprova con corolle più piccole e distanziate (`SKETCH_CROWDING`),
 * perché un fiore nascosto qui sparisce anche dalla foto realistica e il conteggio fallisce.
 */
export async function renderBouquetSketch(
  spec: BouquetPreviewSpec,
  loadCutout: (photoId: string) => Promise<Uint8Array | null>,
): Promise<{
  png: Uint8Array;
  layout: SketchLayout;
  /** Colore dei petali di ogni foto di fiore (per il controllo dei conteggi). */
  photoColors: Record<string, string | null>;
}> {
  const cutouts = new Map<string, Uint8Array>();
  const cutoutAspects: Record<string, number> = {};
  const flowers = flowerPhotoIds(spec);
  await Promise.all(
    sketchPhotoIds(spec).map(async (photoId) => {
      const loaded = await loadCutout(photoId);
      if (!loaded) throw new Error(`ritaglio mancante: ${photoId}`);
      // Fiori: solo la corolla (un ramo vero mostra le corolle, non gli steli).
      const bytes = flowers.has(photoId) ? await bloomHeadFor(photoId, loaded) : loaded;
      const meta = await sharp(bytes).metadata();
      cutouts.set(photoId, bytes);
      cutoutAspects[photoId] = meta.width && meta.height ? meta.width / meta.height : 1;
    }),
  );
  let chosen: { layout: SketchLayout; minVisible: number } | null = null;
  for (let crowding = 0; crowding < SKETCH_CROWDING.levels; crowding++) {
    const layout = layoutBouquetSketch({ spec, cutoutAspects, crowding });
    const minVisible = Math.min(1, ...(await bloomVisibility(layout, cutouts)));
    if (!chosen || minVisible > chosen.minVisible) chosen = { layout, minVisible };
    if (minVisible >= SKETCH_CROWDING.minVisible) break;
  }
  const layout = chosen!.layout;
  const photoColors: Record<string, string | null> = {};
  for (const photoId of flowers) {
    const head = cutouts.get(photoId);
    if (head) photoColors[photoId] = await petalColorOf(head);
  }
  return { png: await renderSketch(layout, cutouts), layout, photoColors };
}
