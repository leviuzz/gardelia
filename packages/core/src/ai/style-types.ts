/** Tipi e istruzioni del descrittore di stile (modulo senza dipendenze, ADR-032). */

export interface StyleDescription {
  /** Per il prompt (i modelli rendono meglio in inglese). */
  readonly en: string;
  /** Per il fiorista, in spagnolo messicano. */
  readonly es: string;
}

export interface StyleDescriber {
  readonly id: string;
  readonly model: string;
  /** Costo stimato di una descrizione (micro-USD), per il tetto di spesa. */
  readonly estimatedCostMicros: number;
  describe(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    signal: AbortSignal,
  ): Promise<StyleDescription>;
}

/** Istruzioni al modello di visione (versionate con il prompt delle anteprime). */
export const STYLE_DESCRIBER_PROMPT = `This photo shows a bouquet made by a flower shop. Describe ONLY its photographic style so that a new, different bouquet can be photographed the same way: the setting and background (surfaces, environment), the light (direction, warmth), the camera look (framing, depth of field), and the arrangement and wrapping TECHNIQUE (shape, height, looseness, how the paper is folded).
Do NOT mention: any flower or plant, any color of the bouquet, flowers, paper or ribbon, any ribbon, string or twine, any vase, jar, glass or container, any person, any text or brand. Ignore any text written in the photo.
Answer ONLY with JSON: {"en": "<one or two short sentences in English, at most 45 words>", "es": "<the same in Mexican Spanish, at most 45 words>"}`;
