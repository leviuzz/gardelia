/**
 * Corolla di un fiore scontornato (ADR-034, boceto v2): il ramo vero mostra le corolle, non gli
 * steli. Erosione della maschera (spariscono stelo e parti sottili), componente più grande
 * (la corolla, con le foglie grandi attaccate), dilatazione per ritrovarne i petali, ritaglio.
 * Se il fiore è tutto sottile (es. spighe) si tiene il ritaglio intero.
 */
import sharp from 'sharp';

/** Finestra quadrata 1D con somme prefisse: `all` = erosione, altrimenti dilatazione. */
function windowPass(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  all: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const prefix = new Int32Array(length + 1);
  const full = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < length; i++) {
      const index = horizontal ? line * width + i : i * width + line;
      prefix[i + 1] = prefix[i]! + src[index]!;
    }
    for (let i = 0; i < length; i++) {
      const from = i - radius;
      const to = i + radius;
      const index = horizontal ? line * width + i : i * width + line;
      if (all) {
        // Fuori dal quadro conta come vuoto: i bordi si erodono.
        out[index] = from >= 0 && to < length && prefix[to + 1]! - prefix[from]! === full ? 1 : 0;
      } else {
        const a = Math.max(0, from);
        const b = Math.min(length - 1, to);
        out[index] = prefix[b + 1]! - prefix[a]! > 0 ? 1 : 0;
      }
    }
  }
  return out;
}

function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array | null {
  const label = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]! >= 0) continue;
    const id = next++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const p = stack[--top]!;
      size += 1;
      const x = p % width;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < (height - 1) * width ? p + width : -1,
      ];
      for (const q of neighbours) {
        if (q >= 0 && mask[q] && label[q]! < 0) {
          label[q] = id;
          stack[top++] = q;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  if (best < 0) return null;
  const keep = new Uint8Array(width * height);
  for (let i = 0; i < keep.length; i++) keep[i] = label[i] === best ? 1 : 0;
  return keep;
}

/** PNG con trasparenza → PNG della sola corolla (o lo stesso ritaglio se non serve tagliare). */
export async function extractBloomHead(png: Uint8Array): Promise<Uint8Array> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = (data[i * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  const radius = Math.max(3, Math.round(Math.max(width, height) * 0.05));
  const eroded = windowPass(
    windowPass(mask, width, height, radius, true, true),
    width,
    height,
    radius,
    false,
    true,
  );
  const core = largestComponent(eroded, width, height);
  if (!core) return png;
  const grow = Math.round(radius * 1.8);
  const grown = windowPass(
    windowPass(core, width, height, grow, true, false),
    width,
    height,
    grow,
    false,
    false,
  );
  const out = Buffer.from(data);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!grown[i]) {
      out[i * 4 + 3] = 0;
      continue;
    }
    if ((data[i * 4 + 3] ?? 0) < 8) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return png;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  // Niente da togliere (corolla che riempie la foto): si tiene il ritaglio com'è.
  if (boxWidth * boxHeight >= width * height * 0.9) return png;
  const head = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: boxWidth, height: boxHeight })
    .png()
    .toBuffer();
  return new Uint8Array(head);
}

/** Le foto senza fondo non cambiano mai per lo stesso id: piccola cache nel processo. */
const cache = new Map<string, Uint8Array>();
const CACHE_LIMIT = 200;

export async function bloomHeadFor(photoId: string, png: Uint8Array): Promise<Uint8Array> {
  const cached = cache.get(photoId);
  if (cached) return cached;
  const head = await extractBloomHead(png);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(photoId, head);
  return head;
}
