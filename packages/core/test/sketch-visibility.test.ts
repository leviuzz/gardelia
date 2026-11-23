import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  SKETCH_CROWDING,
  buildPreviewSpec,
  layoutBouquetSketch,
  type BouquetPreviewSpec,
  type SketchLayout,
} from '@floral/domain';
import { bloomVisibility, renderBouquetSketch } from '../src/index';
import { bloomHeadFor } from '../src/ai/bloom-head';

/**
 * Boceto v4 (ADR-034): ogni corolla deve restare visibile, altrimenti sparisce anche dalla foto
 * realistica e il conteggio fallisce (caso del founder: 2 boccioli rosa dietro 3 rose rosse).
 */

const RED = '0190a0c0-0000-7000-8000-0000000000f1';
const PINK = '0190a0c0-0000-7000-8000-0000000000f2';

const svg = (width: number, height: number, body: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`,
  );

/** Rosa aperta: un disco rosso con due foglioline ai lati. */
async function openRose(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(
      svg(
        420,
        400,
        `<ellipse cx="60" cy="300" rx="55" ry="18" fill="#4f7a3f"/><ellipse cx="360" cy="300" rx="55" ry="18" fill="#4f7a3f"/><circle cx="210" cy="190" r="185" fill="#9e1030"/><circle cx="210" cy="190" r="90" fill="#8a0d27"/>`,
      ),
    )
      .png()
      .toBuffer(),
  );
}

/** Bocciolo stretto con sepali e foglie verdi sotto. */
async function bud(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(
      svg(
        300,
        440,
        `<ellipse cx="150" cy="95" rx="34" ry="62" fill="#f4a9bb"/><ellipse cx="92" cy="170" rx="70" ry="26" fill="#5a7f4a"/><ellipse cx="208" cy="170" rx="70" ry="26" fill="#5a7f4a"/><ellipse cx="150" cy="185" rx="40" ry="34" fill="#4f7a3f"/><rect x="143" y="200" width="14" height="240" fill="#4f7a3f"/>`,
      ),
    )
      .png()
      .toBuffer(),
  );
}

function flowersSpec(seed: number, red: number, pink: number): BouquetPreviewSpec {
  const hex = seed.toString(16).padStart(2, '0');
  const flower = (id: string, name: string, color: string, photo: string, quantity: number) => ({
    catalogItemId: id,
    role: 'FLOWER' as const,
    quantity,
    name,
    variety: null,
    saleUnit: 'STEM' as const,
    colors: [color],
    commonName: null,
    itemType: 'CUT_FLOWER' as const,
    cutoutPhotoId: photo,
  });
  return {
    ...buildPreviewSpec({
      components: [
        flower(`0190a0c0-0000-7000-8000-0000000001${hex}`, 'Fiore 1', 'red', RED, red),
        flower(`0190a0c0-0000-7000-8000-0000000002${hex}`, 'Fiore 2', 'pink', PINK, pink),
      ],
      style: 'GARDEN',
      size: 'MEDIUM',
    }),
    mode: 'EXACT',
  };
}

/** Disposizione a mano: `top` disegnata sopra `bottom`, spostata di `dx`/`dy`. */
function twoBlooms(dx: number, dy: number): SketchLayout {
  const base = layoutBouquetSketch({ spec: flowersSpec(0, 1, 1), cutoutAspects: {} });
  const bloom = { kind: 'bloom' as const, width: 300, height: 300, rotation: 0, flip: false };
  return {
    ...base,
    images: [
      { ...bloom, photoId: PINK, catalogItemId: 'a', x: 512, y: 400, tone: 1 },
      { ...bloom, photoId: RED, catalogItemId: 'b', x: 512 + dx, y: 400 + dy, tone: 1 },
    ],
  };
}

describe('boceto v4: ogni corolla resta visibile', () => {
  it('misura i petali rimasti in cima; il verde coperto non conta', async () => {
    const cutouts = new Map([
      [PINK, await bud()],
      [RED, await openRose()],
    ]);
    // La rosa sopra copre il bocciolo (petali compresi): poco visibile; la rosa, tutta.
    const covered = await bloomVisibility(twoBlooms(0, -40), cutouts);
    expect(covered[0]).toBeLessThan(0.3);
    expect(covered[1]).toBe(1);
    // La rosa copre solo foglie e sepali (sotto il bocciolo): i petali restano tutti visibili.
    const leavesOnly = await bloomVisibility(twoBlooms(0, 230), cutouts);
    expect(leavesOnly[0]).toBeGreaterThan(0.95);
    // Fuori dal quadro conta come nascosto.
    const outside = twoBlooms(0, 0);
    const shifted = {
      ...outside,
      images: [
        { ...outside.images[0]!, x: -120 },
        { ...outside.images[1]!, x: 2000 },
      ],
    };
    expect(Math.max(...(await bloomVisibility(shifted, cutouts)))).toBeLessThan(0.5);
  });

  it('su ramos diversi il boceto scelto lascia visibile ogni fiore', async () => {
    const raw = new Map([
      [RED, await openRose()],
      [PINK, await bud()],
    ]);
    const heads = new Map<string, Uint8Array>();
    for (const [id, bytes] of raw) heads.set(id, await bloomHeadFor(id, bytes));
    for (const [seed, red, pink] of [
      [1, 3, 2],
      [7, 3, 2],
      [32, 9, 6],
      [3, 12, 8],
    ] as const) {
      const { layout } = await renderBouquetSketch(
        flowersSpec(seed, red, pink),
        async (id) => raw.get(id) ?? null,
      );
      const visible = await bloomVisibility(layout, heads);
      expect(visible).toHaveLength(red + pink);
      expect(Math.min(...visible)).toBeGreaterThanOrEqual(SKETCH_CROWDING.minVisible);
    }
  });
});
