/**
 * Provider delle immagini AI [O-01, ADR-025, ADR-026].
 *
 *  - Interfaccia unica (`provider-types.ts`): il resto del sistema non sa quale modello genera
 *    l'immagine.
 *  - `FalImageProvider` (`fal.ts`): il provider reale, scelto col benchmark sui ramos demo.
 *  - `SimulatedImageProvider`: SOLO sviluppo/test (APP_URL locale), disegna un'immagine
 *    astratta dai colori della distinta; la UI la etichetta sempre come simulazione.
 *    In produzione l'app rifiuta di avviarsi con questo provider (CLAUDE.md: niente AI finta).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import type { BouquetPreviewSpec } from '@floral/domain';
import { DEFAULT_FAL_MODEL, FAL_MODEL_IDS, FalImageProvider, isFalModelId } from './fal';
import type { AiImageProvider, GeneratedImage } from './provider-types';
import { aiConfig } from '../config';

export {
  AiProviderError,
  NON_RETRYABLE_AI_ERRORS,
  sniffImageType,
  type AiImageProvider,
  type AiProviderErrorCode,
  type GeneratedImage,
  type ImageInput,
} from './provider-types';

// -----------------------------------------------------------------------------
// PNG minimale (RGB 8 bit) senza dipendenze
// -----------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

// -----------------------------------------------------------------------------
// Provider simulato (sviluppo/test)
// -----------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

const COLOR_RGB: Readonly<Record<string, Rgb>> = {
  red: [192, 57, 43],
  pink: [242, 167, 185],
  fuchsia: [194, 24, 91],
  white: [250, 250, 248],
  cream: [243, 233, 210],
  yellow: [246, 201, 69],
  orange: [239, 138, 60],
  peach: [247, 198, 163],
  coral: [242, 125, 114],
  purple: [126, 87, 194],
  lilac: [200, 162, 224],
  blue: [91, 141, 239],
  green: [95, 143, 90],
  burgundy: [123, 30, 58],
  multicolor: [230, 120, 160],
  black: [35, 35, 35],
  gold: [212, 175, 55],
  silver: [192, 196, 200],
  brown: [139, 94, 60],
  transparent: [236, 240, 244],
};

function colorOf(colors: readonly string[], fallback: Rgb): Rgb {
  for (const color of colors) {
    const rgb = COLOR_RGB[color];
    if (rgb) return rgb;
  }
  return fallback;
}

/** Disegno astratto e deterministico del ramo: fiori a spicchi, follaje, listón, empaque. */
export function renderSimulatedBouquet(spec: BouquetPreviewSpec, size = 384): Uint8Array {
  const flowers = spec.components.filter((component) => component.role === 'FLOWER');
  const foliage = spec.components.find((component) => component.role === 'FOLIAGE');
  const accessory = spec.components.find((component) => component.role === 'ACCESSORY');
  const packaging = spec.components.find((component) => component.role === 'PACKAGING');
  const totalFlowers = flowers.reduce((sum, component) => sum + component.quantity, 0) || 1;
  const sectors: { until: number; rgb: Rgb }[] = [];
  let acc = 0;
  for (const flower of flowers) {
    acc += flower.quantity / totalFlowers;
    sectors.push({ until: acc, rgb: colorOf(flower.colors, [235, 150, 170]) });
  }
  const background: Rgb = [246, 241, 231];
  const stems: Rgb = [90, 130, 80];
  const foliageRgb = foliage ? colorOf(foliage.colors, [110, 150, 110]) : null;
  const ribbonRgb = accessory ? colorOf(accessory.colors, [180, 60, 80]) : null;
  const wrapRgb = packaging ? colorOf(packaging.colors, [196, 160, 118]) : null;

  const rgb = new Uint8Array(size * size * 3);
  const cx = size / 2;
  const cy = size * 0.42;
  const radius = size * 0.36;
  const coneTop = size * 0.62;
  const coneBottom = size * 0.95;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color: Rgb = background;
      const halfWidth = ((coneBottom - y) / (coneBottom - coneTop)) * size * 0.24;
      if (y >= coneTop && y <= coneBottom && Math.abs(x - cx) <= halfWidth) {
        color = wrapRgb ?? (Math.abs(x - cx) % 14 < 3 ? stems : background);
        if (ribbonRgb && y >= coneTop + size * 0.03 && y <= coneTop + size * 0.06)
          color = ribbonRgb;
      }
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        if (foliageRgb && distance > radius * 0.86) {
          color = foliageRgb;
        } else {
          const turn = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
          color =
            sectors.find((sector) => turn <= sector.until)?.rgb ?? sectors.at(-1)?.rgb ?? color;
          // Petali: leggera variazione di luminosità per distinguere i fiori.
          const shade = Math.cos(distance / 9) * 10;
          color = [
            Math.max(0, Math.min(255, color[0] + shade)),
            Math.max(0, Math.min(255, color[1] + shade)),
            Math.max(0, Math.min(255, color[2] + shade)),
          ];
        }
      }
      const offset = (y * size + x) * 3;
      rgb[offset] = color[0];
      rgb[offset + 1] = color[1];
      rgb[offset + 2] = color[2];
    }
  }
  return encodePng(size, size, rgb);
}

export class SimulatedImageProvider implements AiImageProvider {
  readonly id = 'simulated';
  readonly model = 'simulated-v1';
  readonly simulated = true;
  readonly acceptsImages = true;

  constructor(
    readonly estimatedCostMicros = 0,
    private readonly latencyMs = 400,
  ) {}

  async generate(request: {
    readonly spec: BouquetPreviewSpec;
    readonly signal: AbortSignal;
  }): Promise<GeneratedImage> {
    await delay(this.latencyMs, undefined, { signal: request.signal });
    // Con o senza le foto dei fiori lo stesso disegno schematico (nessuna AI; la UI lo dichiara).
    return { bytes: renderSimulatedBouquet(request.spec), contentType: 'image/png', costMicros: 0 };
  }
}

// -----------------------------------------------------------------------------
// Configurazione
// -----------------------------------------------------------------------------

/** null = anteprime AI non disponibili (nessun provider configurato). */
export function createAiProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AiImageProvider | null {
  // Le regole (simulato solo in locale, chiave fal obbligatoria) stanno in config.ts.
  const config = aiConfig(env);
  if (config.AI_PROVIDER === 'none') return null;
  if (config.AI_PROVIDER === 'simulated') return new SimulatedImageProvider();
  const model = config.AI_MODEL ?? DEFAULT_FAL_MODEL;
  if (!isFalModelId(model)) {
    throw new Error(
      `AI_MODEL non supportato con fal: ${model} (ammessi: ${FAL_MODEL_IDS.join(', ')}).`,
    );
  }
  return new FalImageProvider({ apiKey: config.FAL_KEY ?? '', model });
}

let provider: AiImageProvider | null | undefined;

export function getAiProvider(): AiImageProvider | null {
  if (provider === undefined) provider = createAiProviderFromEnv();
  return provider;
}

/** Solo per i test: sostituisce il provider del processo. */
export function setAiProvider(next: AiImageProvider | null | undefined): void {
  provider = next;
}

/** Tetto di spesa mensile della piattaforma (ADR-024), in micro-USD. */
export function aiMonthlyBudgetMicros(env: NodeJS.ProcessEnv = process.env): number {
  return Math.round(aiConfig(env).AI_MONTHLY_BUDGET_USD * 1_000_000);
}
