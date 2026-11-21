import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractBloomHead } from '../src/ai/bloom-head';

/** Fiore scontornato di prova: corolla rotonda con un lungo stelo sottile (PNG trasparente). */
async function flowerWithStem(): Promise<Uint8Array> {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="480"><circle cx="150" cy="110" r="100" fill="#c0392b"/><rect x="144" y="200" width="12" height="270" fill="#3d7a3a"/></svg>',
  );
  return new Uint8Array(await sharp(svg).png().toBuffer());
}

describe('corolla dal ritaglio (boceto v2)', () => {
  it('toglie lo stelo lungo e tiene la corolla intera', async () => {
    const head = await sharp(await extractBloomHead(await flowerWithStem())).metadata();
    // Corolla di 200 px: resta (con un margine), lo stelo di 270 px sparisce quasi tutto.
    expect(head.width).toBeGreaterThanOrEqual(195);
    expect(head.width).toBeLessThanOrEqual(215);
    expect(head.height).toBeLessThan(270);
    expect(head.height).toBeGreaterThanOrEqual(195);
  });

  it('una corolla senza stelo resta com’è', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><circle cx="110" cy="110" r="108" fill="#f6c945"/></svg>',
    );
    const png = new Uint8Array(await sharp(svg).png().toBuffer());
    const meta = await sharp(await extractBloomHead(png)).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(214);
    expect(meta.height).toBeGreaterThanOrEqual(214);
  });
});
