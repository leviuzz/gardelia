/**
 * Disegno del boceto esatto (ADR-034): la geometria viene da `layoutBouquetSketch` (dominio,
 * deterministica); qui si disegnano carta, steli, contenitore e fiocco in SVG e si compongono
 * i ritagli delle foto del fiorista con sharp. Nessuna rete, nessun costo.
 */
import sharp, { type OverlayOptions } from 'sharp';
import {
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

/** Foto scontornate che il boceto userà (fiori contati, riempimento e follaje con ritaglio). */
export function sketchPhotoIds(spec: BouquetPreviewSpec): string[] {
  const ids = new Set<string>();
  for (const flower of countedFlowers(spec))
    if (flower.cutoutPhotoId) ids.add(flower.cutoutPhotoId);
  for (const component of spec.components) {
    if ((component.role === 'FLOWER' || component.role === 'FOLIAGE') && component.cutoutPhotoId) {
      ids.add(component.cutoutPhotoId);
    }
  }
  return [...ids];
}

/**
 * Boceto completo di una distinta: carica i ritagli (miniature PNG con trasparenza), ne legge le
 * proporzioni, calcola la disposizione e la disegna.
 */
export async function renderBouquetSketch(
  spec: BouquetPreviewSpec,
  loadCutout: (photoId: string) => Promise<Uint8Array | null>,
): Promise<{ png: Uint8Array; layout: SketchLayout }> {
  const cutouts = new Map<string, Uint8Array>();
  const cutoutAspects: Record<string, number> = {};
  await Promise.all(
    sketchPhotoIds(spec).map(async (photoId) => {
      const bytes = await loadCutout(photoId);
      if (!bytes) throw new Error(`ritaglio mancante: ${photoId}`);
      const meta = await sharp(bytes).metadata();
      cutouts.set(photoId, bytes);
      cutoutAspects[photoId] = meta.width && meta.height ? meta.width / meta.height : 1;
    }),
  );
  const layout = layoutBouquetSketch({ spec, cutoutAspects });
  return { png: await renderSketch(layout, cutouts), layout };
}
