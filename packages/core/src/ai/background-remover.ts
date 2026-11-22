/**
 * Scontorno delle foto del catalogo (ADR-033).
 *
 *  - Produzione: BiRefNet via fal (`FalBackgroundRemover`), ritagli buoni anche su fondi
 *    normali (tavolo, negozio) a una frazione di centesimo per foto.
 *  - Sviluppo/test: `ChromaKeyBackgroundRemover`, un algoritmo locale e deterministico che
 *    funziona solo con un fondo liso (toglie i pixel simili al bordo e collegati ad esso).
 *  - Il risultato è sempre un PNG con trasparenza; il controllo di qualità e la rifinitura
 *    (`finishCutout`) sono comuni.
 */
import sharp from 'sharp';
import { judgeCutout, type CutoutError } from '@floral/domain';
import { FalBackgroundRemover } from './fal';
import { aiConfig } from '../config';

export interface BackgroundRemover {
  readonly id: string;
  readonly model: string;
  /** Costo stimato per foto (micro-USD), per il tetto di spesa. */
  readonly estimatedCostMicros: number;
  remove(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    signal: AbortSignal,
  ): Promise<{ readonly png: Uint8Array; readonly costMicros: number | null }>;
}

const WORK_SIDE = 1024;

/**
 * Ritaglio locale per foto su fondo liso: il colore del fondo è la mediana dei pixel del bordo;
 * è fondo ciò che gli somiglia ED è collegato al bordo (così i petali bianchi interni restano
 * anche su un fondo bianco). Bordi ammorbiditi. Nessuna rete, nessun costo.
 */
export class ChromaKeyBackgroundRemover implements BackgroundRemover {
  readonly id = 'local';
  readonly model = 'chroma-key-v1';
  readonly estimatedCostMicros = 0;

  constructor(
    private readonly low = 22,
    private readonly high = 48,
  ) {}

  async remove(image: { readonly bytes: Uint8Array }) {
    const { data, info } = await sharp(image.bytes)
      .rotate()
      .resize(WORK_SIDE, WORK_SIDE, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const channel = (i: number, c: number) => data[i * 3 + c] ?? 0;
    const borderIndexes: number[] = [];
    for (let x = 0; x < w; x++) borderIndexes.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) borderIndexes.push(y * w, y * w + w - 1);
    const median = [0, 1, 2].map((c) => {
      const values = borderIndexes.map((i) => channel(i, c)).sort((a, b) => a - b);
      return values[values.length >> 1] ?? 0;
    });
    const distance = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      distance[i] = Math.hypot(
        channel(i, 0) - (median[0] ?? 0),
        channel(i, 1) - (median[1] ?? 0),
        channel(i, 2) - (median[2] ?? 0),
      );
    }
    const background = new Uint8Array(w * h);
    const stack: number[] = [];
    const visit = (i: number) => {
      if (!background[i] && (distance[i] ?? Infinity) < this.high) {
        background[i] = 1;
        stack.push(i);
      }
    };
    for (const i of borderIndexes) visit(i);
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < (h - 1) * w) visit(i + w);
    }
    const alpha = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) {
      const ramp = ((distance[i] ?? 0) - this.low) / (this.high - this.low);
      alpha[i] = background[i] ? Math.round(255 * Math.min(1, Math.max(0, ramp))) : 255;
    }
    const soft = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
      .blur(0.8)
      // Un solo canale in uscita (sharp convertirebbe il grigio in RGB).
      .extractChannel(0)
      .raw()
      .toBuffer();
    const png = await sharp(data, { raw: { width: w, height: h, channels: 3 } })
      .joinChannel(soft, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toBuffer();
    return { png: new Uint8Array(png), costMicros: 0 };
  }
}

export interface FinishedCutout {
  readonly full: Uint8Array;
  readonly thumb: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly opaqueRatio: number;
}

/**
 * Controlla e rifinisce il PNG restituito dal ritagliatore (dato non fidato): quota di pixel
 * visibili, margini trasparenti tagliati, lato lungo ≤ 1600 px e miniatura da 480 px.
 */
export async function finishCutout(
  png: Uint8Array,
): Promise<{ ok: true; cutout: FinishedCutout } | { ok: false; error: CutoutError }> {
  const { data, info } = await sharp(png, { limitInputPixels: 50_000_000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Quota di pixel visibili e riquadro del soggetto, dal solo canale alfa (i colori sotto la
  // trasparenza non contano: per questo niente `trim` di sharp).
  let opaque = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 3, p = 0; i < data.length; i += 4, p += 1) {
    const alpha = data[i] ?? 0;
    if (alpha >= 128) opaque += 1;
    if (alpha >= 8) {
      const x = p % info.width;
      const y = (p - x) / info.width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const opaqueRatio = opaque / (info.width * info.height);
  const error = judgeCutout(opaqueRatio);
  if (error || maxX < 0) return { ok: false, error: error ?? 'cutout_nothing_kept' };
  const margin = 4;
  const left = Math.max(0, minX - margin);
  const top = Math.max(0, minY - margin);
  const trimmed = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract({
      left,
      top,
      width: Math.min(info.width, maxX + margin + 1) - left,
      height: Math.min(info.height, maxY + margin + 1) - top,
    })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(trimmed.data)
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    ok: true,
    cutout: {
      full: new Uint8Array(trimmed.data),
      thumb: new Uint8Array(thumb),
      width: trimmed.info.width,
      height: trimmed.info.height,
      opaqueRatio,
    },
  };
}

/** Stesso provider delle anteprime: fal in produzione, algoritmo locale solo in locale. */
export function createBackgroundRemoverFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundRemover | null {
  const config = aiConfig(env);
  if (config.AI_PROVIDER === 'fal')
    return new FalBackgroundRemover({ apiKey: config.FAL_KEY ?? '' });
  if (config.AI_PROVIDER === 'simulated') return new ChromaKeyBackgroundRemover();
  return null;
}

let remover: BackgroundRemover | null | undefined;

export function getBackgroundRemover(): BackgroundRemover | null {
  if (remover === undefined) remover = createBackgroundRemoverFromEnv();
  return remover;
}

/** Solo per i test: sostituisce lo scontornatore del processo. */
export function setBackgroundRemover(next: BackgroundRemover | null | undefined): void {
  remover = next;
}
