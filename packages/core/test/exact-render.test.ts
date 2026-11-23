import { describe, expect, it, vi } from 'vitest';
import {
  buildPreviewSpec,
  countTargets,
  type BouquetPreviewSpec,
  type CountCheckResult,
  type CountTarget,
} from '@floral/domain';
import { AiProviderError, type AiImageProvider, type GeneratedImage } from '../src/index';
import { renderVerifiedPhoto } from '../src/ai/exact-render';
import type { FlowerCounter } from '../src/ai/flower-counter-types';

/**
 * Foto verificata dell'anteprima esatta (ADR-034 v7): foto naturale dal boceto, conteggio,
 * correzione dei soli fiori in più sulla stessa foto, altrimenti nuova foto; al massimo 3 immagini.
 */

const spec: BouquetPreviewSpec = {
  ...buildPreviewSpec({
    components: [
      {
        catalogItemId: '0190a0c0-0000-7000-8000-0000000000b1',
        role: 'FLOWER',
        quantity: 3,
        name: 'Rosa roja',
        variety: null,
        saleUnit: 'STEM',
        colors: ['red'],
        commonName: 'Rose',
        itemType: 'CUT_FLOWER',
        cutoutPhotoId: '0190a0c0-0000-7000-8000-0000000000a1',
      },
      {
        catalogItemId: '0190a0c0-0000-7000-8000-0000000000b2',
        role: 'FLOWER',
        quantity: 2,
        name: 'Tulipán rosa',
        variety: null,
        saleUnit: 'STEM',
        colors: ['pink'],
        commonName: 'Tulip',
        itemType: 'CUT_FLOWER',
        cutoutPhotoId: '0190a0c0-0000-7000-8000-0000000000a2',
      },
    ],
    style: 'GARDEN',
    size: 'MEDIUM',
  }),
  mode: 'EXACT',
};
const targets = countTargets(spec);
// Le foto dei fiori (rosa e tulipano): primo byte 1 e 2.
const references = [
  { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' },
  { bytes: new Uint8Array([2, 2, 3]), contentType: 'image/jpeg' },
];

/** Ogni immagine generata ha un byte diverso: si vede da quale foto parte la correzione. */
class StubProvider implements AiImageProvider {
  readonly id = 'stub';
  readonly model = 'stub-edit';
  readonly simulated = false;
  readonly acceptsImages = true;
  readonly estimatedCostMicros = 80_000;
  calls: { prompt: string; images: (number | undefined)[] }[] = [];
  async generate(request: {
    readonly prompt: string;
    readonly images?: readonly { readonly bytes: Uint8Array }[];
  }): Promise<GeneratedImage> {
    this.calls.push({
      prompt: request.prompt,
      images: (request.images ?? []).map((image) => image.bytes[0]),
    });
    return {
      bytes: new Uint8Array([100 + this.calls.length]),
      contentType: 'image/jpeg',
      costMicros: 80_000,
    };
  }
}

/** Risposte in coda: [rose, tulipani] trovati, oppure 'error'. */
class StubCounter implements FlowerCounter {
  readonly id = 'stub';
  readonly model = 'stub-count';
  readonly simulated = false;
  readonly estimatedCostMicros = 12_000;
  constructor(private readonly answers: ([number, number] | 'error')[]) {}
  async count(_image: unknown, _targets: readonly CountTarget[]): Promise<CountCheckResult> {
    const answer = this.answers.shift() ?? [3, 2];
    if (answer === 'error') throw new AiProviderError('provider_error', 'vision down');
    return { counts: { 1: answer[0], 2: answer[1] }, other: 0 };
  }
}

function run(answers: ([number, number] | 'error')[], counter = true) {
  const provider = new StubProvider();
  const onCountUnavailable = vi.fn();
  const result = renderVerifiedPhoto({
    provider,
    counter: counter ? new StubCounter(answers) : null,
    spec,
    references,
    prompt: 'natural bouquet',
    targets,
    onCountUnavailable,
  });
  return { provider, onCountUnavailable, result };
}

describe('foto verificata (v7)', () => {
  it('fiori in più: li toglie sulla stessa foto e la accetta', async () => {
    const { provider, result } = run([
      [4, 3],
      [3, 2],
    ]);
    const { accepted, checks, spentMicros } = await result;
    expect(accepted?.verified).toBe(true);
    expect(checks.map((check) => check.step)).toEqual(['render', 'fix']);
    // La correzione parte dalla prima foto generata (byte 101), non dalle foto dei fiori.
    expect(provider.calls.map((call) => call.images)).toEqual([[1, 2], [101]]);
    expect(provider.calls[1]?.prompt).toContain('Remove 1 red rose and 1 pink tulip');
    expect(spentMicros).toBe(2 * 80_000 + 2 * 12_000);
  });

  it('fiori mancanti: niente correzione, nuova foto dalle foto dei fiori', async () => {
    const { provider, result } = run([
      [2, 2],
      [3, 2],
    ]);
    const { accepted, checks } = await result;
    expect(accepted?.verified).toBe(true);
    expect(checks.map((check) => check.step)).toEqual(['render', 'render']);
    expect(provider.calls.map((call) => call.images)).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it('al massimo 3 immagini; una correzione che non ha tolto nulla non si ripete, si rifà', async () => {
    const { provider, result } = run([
      [4, 2],
      [4, 2],
      [4, 2],
      [3, 2],
    ]);
    const { accepted, checks, spentMicros } = await result;
    expect(accepted).toBeNull();
    expect(checks.map((check) => check.step)).toEqual(['render', 'fix', 'render']);
    expect(provider.calls).toHaveLength(3);
    expect(spentMicros).toBe(3 * 80_000 + 3 * 12_000);
  });

  it('una correzione che ha tolto fiori ma non tutti si corregge di nuovo (caso del 23/11)', async () => {
    const { provider, result } = run([
      [5, 3],
      [4, 2],
      [3, 2],
    ]);
    const { accepted, checks } = await result;
    expect(accepted?.verified).toBe(true);
    expect(checks.map((check) => check.step)).toEqual(['render', 'fix', 'fix']);
    // La seconda correzione parte dalla prima correzione (byte 102), non da una foto nuova.
    expect(provider.calls.map((call) => call.images)).toEqual([[1, 2], [101], [102]]);
    expect(provider.calls[2]?.prompt).toContain('Remove 1 red rose completely');
  });

  it('una correzione che aggiunge un fiore di un altro tipo ma ne toglie di più vale come progresso', async () => {
    const { provider, result } = run([
      [3, 4],
      [4, 2],
      [3, 2],
    ]);
    const { accepted, checks } = await result;
    expect(accepted?.verified).toBe(true);
    expect(checks.map((check) => check.step)).toEqual(['render', 'fix', 'fix']);
    expect(provider.calls[1]?.prompt).toContain('Remove 2 pink tulips');
    expect(provider.calls[2]?.prompt).toContain('Remove 1 red rose');
  });

  it('senza controllo o se non risponde: la prima foto, non verificata', async () => {
    const without = await run([], false).result;
    expect(without.accepted?.verified).toBeNull();
    const down = run(['error']);
    const { accepted, checks } = await down.result;
    expect(accepted?.verified).toBeNull();
    expect(checks).toEqual([]);
    expect(down.onCountUnavailable).toHaveBeenCalledTimes(1);
    expect(down.provider.calls).toHaveLength(1);
  });
});
