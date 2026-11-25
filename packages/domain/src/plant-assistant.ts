/**
 * Floral Care, blocco 6 (ADR-085) — l'Asistente de plantas: regole pure.
 *
 *  - È per i clienti della fioreria, in Mi Floral Care: la fioreria compra crediti da Gardelia e li
 *    dà ai suoi contratti (founder, 25/11). 1 credito = 1 risposta riuscita; un errore o un rifiuto
 *    non usa crediti.
 *  - Due passi. Riconoscimento: una foto → fino a 3 specie della NOSTRA lista, ciò che si vede
 *    (foglie gialle, punte secche…) e se sembra avere un problema. Risposta: solo testo (la foto non
 *    si rimanda) con la specie confermata da chi chiede, i nostri dati di cura e la domanda.
 *  - Mix dei modelli (prova pagata, docs/AI_BENCHMARK.md): il riconoscimento e le domande su un
 *    problema con il modello principale, le domande di cura con quello leggero.
 *  - Il modello non dà mai dosi di prodotti chimici e non parla di tossicità: l'avviso viene solo
 *    dai nostri dati (`plant-care.ts`).
 *  - Il costo di ogni chiamata si calcola dai token veri (`usage`) con il listino qui sotto.
 */
import { z } from 'zod';
import { zonedDateTime } from './ai';
import { todayInTimeZone } from './customer';
import type { SupportedLocale } from './i18n';
import type { PlantCare } from './plant-care';
import { requiredInteger, toTrimmedString } from './validation';

export const ASSISTANT_LIMITS = {
  /** Caratteri della domanda. */
  question: 500,
  /** Risposte per caso («Otra pregunta» senza rifare la foto). */
  answersPerCase: 3,
  /** Risposte al giorno per contratto, anche con crediti: argine agli abusi. */
  contractAnswersPerDay: 10,
  /** Foto riconosciute al giorno per contratto: argine agli abusi. */
  contractCasesPerDay: 10,
  /** Specie proposte dal riconoscimento. */
  candidates: 3,
  /** Caratteri salvati della condizione vista nella foto, della risposta e di ogni passo. */
  conditionChars: 300,
  answerChars: 1200,
  steps: 5,
  stepChars: 240,
  /** Lato lungo della copia della foto mandata al modello (meno token). */
  modelImageSide: 1092,
  /** Tetto di una chiamata al modello. */
  timeoutMs: 45_000,
  /** Budget mensile di piattaforma (rete di sicurezza) finché il founder non lo fissa. */
  defaultMonthlyBudgetUsd: 20,
} as const;

/**
 * Crediti dell'assistente (founder, 25/11): la fioreria li compra da Gardelia come i crediti delle
 * immagini (WhatsApp, poi accredito della piattaforma) e li dà ai contratti quando vuole. Il
 * prezzo non sta nel codice (D-16/17): lo dice la piattaforma quando si comprano.
 */
export const ASSISTANT_CREDITS = {
  /** Crediti usati da una risposta riuscita (l'analisi della foto è compresa nella prima). */
  perAnswer: 1,
  /** Crediti dati a un contratto in una volta. */
  maxGive: 500,
  /** Una riserva fatta prima di chiamare il modello vale al massimo 2 minuti. */
  holdSeconds: 120,
} as const;

/** Crediti ancora da dare della fioreria: comprati meno quelli dati ai contratti (resi compresi). */
export function assistantShopAvailable(purchased: number, allocated: number): number {
  return Math.max(0, purchased - allocated);
}

/** Crediti ancora usabili di un contratto: dati meno risposte riuscite e riserve in corso. */
export function assistantContractAvailable(allocated: number, used: number, held: number): number {
  return Math.max(0, allocated - used - held);
}

/** «Dar créditos» a un contratto. */
export const assistantCreditGiveSchema = z.object({
  credits: requiredInteger({ min: 1, max: ASSISTANT_CREDITS.maxGive }),
});
export type AssistantCreditGiveInput = z.infer<typeof assistantCreditGiveSchema>;

export const ASSISTANT_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];

export function isAssistantModel(value: unknown): value is AssistantModel {
  return typeof value === 'string' && (ASSISTANT_MODELS as readonly string[]).includes(value);
}

/**
 * Che cosa vuole sapere chi chiede: CARE = come curarla (acqua, luce, posto), PROBLEM = le succede
 * qualcosa (foglie, macchie, parassiti). Sceglie il modello della risposta.
 */
export const ASSISTANT_QUESTION_KINDS = ['CARE', 'PROBLEM'] as const;
export type AssistantQuestionKind = (typeof ASSISTANT_QUESTION_KINDS)[number];

/**
 * I due modelli configurati (o i loro adattatori): il principale (foto e problemi) e quello
 * leggero (cura).
 */
export interface AssistantModels<T = AssistantModel> {
  readonly main: T;
  readonly care: T;
}

/** Chi risponde: le domande di cura al modello leggero, i problemi al principale. */
export function assistantAnswerModel<T>(
  models: AssistantModels<T>,
  kind: AssistantQuestionKind,
): T {
  return kind === 'CARE' ? models.care : models.main;
}

/** La scelta proposta: «Tiene un problema» se la foto lo mostra o se la specie non si sa. */
export function assistantDefaultKind(input: {
  readonly looksUnhealthy: boolean;
  readonly speciesKnown: boolean;
}): AssistantQuestionKind {
  return input.looksUnhealthy || !input.speciesKnown ? 'PROBLEM' : 'CARE';
}

interface ModelRates {
  /** Micro-USD per milione di token. */
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

/**
 * Listino dell'API di Claude (prezzi di prima parte, verificati il 25/11/2026), in micro-USD per
 * milione di token: 4 USD = 4_000_000. Scrittura in cache a 5 minuti = 1,25 × l'entrata.
 * Haiku 5.5 ha un secondo listino oltre i 100.000 token di richiesta.
 */
export const ASSISTANT_MODEL_RATES: Readonly<
  Record<AssistantModel, ModelRates & { readonly long?: ModelRates & { readonly above: number } }>
> = {
  'claude-opus-5-5': {
    input: 4_000_000,
    output: 20_000_000,
    cacheWrite: 5_000_000,
    cacheRead: 200_000,
  },
  'claude-sonnet-5-5': {
    input: 2_000_000,
    output: 10_000_000,
    cacheWrite: 2_500_000,
    cacheRead: 100_000,
  },
  'claude-haiku-5-5': {
    input: 100_000,
    output: 500_000,
    cacheWrite: 125_000,
    cacheRead: 10_000,
    long: {
      above: 100_000,
      input: 500_000,
      output: 2_500_000,
      cacheWrite: 625_000,
      cacheRead: 50_000,
    },
  },
};

/**
 * Modelli che possono rispondere al posto di quello chiesto con il fallback lato server (stesso
 * listino ufficiale). Un modello sconosciuto si paga come Opus 5, il più caro fra quelli realistici:
 * il budget non si sottostima mai.
 */
const FALLBACK_MODEL_RATES: Readonly<Record<string, ModelRates>> = {
  'claude-opus-5': {
    input: 5_000_000,
    output: 25_000_000,
    cacheWrite: 6_250_000,
    cacheRead: 500_000,
  },
  'claude-opus-4-8': {
    input: 5_000_000,
    output: 25_000_000,
    cacheWrite: 6_250_000,
    cacheRead: 500_000,
  },
  'claude-sonnet-5': {
    input: 2_000_000,
    output: 10_000_000,
    cacheWrite: 2_500_000,
    cacheRead: 200_000,
  },
};
const UNKNOWN_MODEL_RATES = FALLBACK_MODEL_RATES['claude-opus-5']!;

export interface AssistantUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
}

function ratesFor(model: string, promptTokens: number): ModelRates {
  if (isAssistantModel(model)) {
    const base = ASSISTANT_MODEL_RATES[model];
    return base.long && promptTokens > base.long.above ? base.long : base;
  }
  return FALLBACK_MODEL_RATES[model] ?? UNKNOWN_MODEL_RATES;
}

/**
 * Costo vero di una chiamata, in micro-USD (arrotondato per eccesso), per il modello che ha
 * risposto (anche uno del fallback).
 */
export function assistantCallCostMicros(model: string, usage: AssistantUsage): number {
  const promptTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const rates = ratesFor(model, promptTokens);
  const total =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheCreationTokens * rates.cacheWrite +
    usage.cacheReadTokens * rates.cacheRead;
  return Math.ceil(total / 1_000_000);
}

/**
 * Stima prudente di una chiamata, per il budget prima di chiamare (poi si scrive il costo vero):
 * richiesta di ~3.000 token e risposta di ~1.500, pensiero compreso.
 */
export function assistantEstimatedCostMicros(model: AssistantModel): number {
  return assistantCallCostMicros(model, {
    inputTokens: 3_000,
    outputTokens: 1_500,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  });
}

/** Inizio del giorno nell'ora della fioreria (limiti al giorno). */
export function assistantDayStart(timeZone: string, now: Date = new Date()): Date {
  return zonedDateTime(todayInTimeZone(timeZone, now), 0, timeZone);
}

// -----------------------------------------------------------------------------
// Input di chi chiede
// -----------------------------------------------------------------------------

export const assistantQuestionSchema = z.object({
  kind: z.enum(ASSISTANT_QUESTION_KINDS, { error: 'required' }),
  question: z.preprocess(
    toTrimmedString,
    z
      .string({ error: 'required' })
      .min(1, { error: 'required' })
      .max(ASSISTANT_LIMITS.question, { error: 'too_long' }),
  ),
  /** La specie confermata o corretta da chi chiede; vuota = «No sé». */
  speciesSlug: z.preprocess((value) => {
    const trimmed = toTrimmedString(value);
    return trimmed === '' || trimmed === undefined ? null : trimmed;
  }, z.string().max(80).nullable()),
});
export type AssistantQuestionInput = z.infer<typeof assistantQuestionSchema>;

/** Codici dei problemi (testi in `assistant.conflict.*` dei messaggi del web). */
export type AssistantProblem =
  | 'assistant_unavailable'
  | 'assistant_daily_limit'
  | 'assistant_budget_reached'
  | 'assistant_photo_unusable'
  | 'assistant_case_full'
  | 'assistant_failed'
  /** Il contratto non ha più crediti: si chiedono alla fioreria. */
  | 'assistant_no_credits'
  /** La fioreria non ha abbastanza crediti da dare. */
  | 'assistant_shop_credits'
  /** Il contratto non è attivo né in pausa. */
  | 'assistant_contract_closed'
  /** «Enviar a la florería» su un caso ancora senza risposte. */
  | 'assistant_nothing_to_send';

// -----------------------------------------------------------------------------
// Output del modello (output strutturato) e pulizia
// -----------------------------------------------------------------------------

export const ASSISTANT_LIKELIHOODS = ['high', 'medium', 'low'] as const;
export type AssistantLikelihood = (typeof ASSISTANT_LIKELIHOODS)[number];

/**
 * Schema chiesto al modello per il riconoscimento. Volutamente semplice (niente lunghezze o
 * massimi: l'output strutturato non li supporta tutti); i limiti li applica `cleanRecognition`.
 */
export const assistantRecognitionOutputSchema = z.object({
  photoUsable: z.boolean(),
  candidates: z.array(z.object({ slug: z.string(), likelihood: z.enum(ASSISTANT_LIKELIHOODS) })),
  notInList: z.boolean(),
  condition: z.string(),
  /** La foto mostra segni di un problema (propone «Tiene un problema»). */
  looksUnhealthy: z.boolean(),
});
export type AssistantRecognitionOutput = z.infer<typeof assistantRecognitionOutputSchema>;

export const assistantAnswerOutputSchema = z.object({
  answer: z.string(),
  steps: z.array(z.string()),
  unsure: z.boolean(),
  askFlorist: z.boolean(),
});
export type AssistantAnswerOutput = z.infer<typeof assistantAnswerOutputSchema>;

export interface AssistantCandidate {
  readonly slug: string;
  readonly likelihood: AssistantLikelihood;
}

export interface AssistantRecognition {
  readonly photoUsable: boolean;
  readonly candidates: readonly AssistantCandidate[];
  readonly notInList: boolean;
  readonly condition: string;
  readonly looksUnhealthy: boolean;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Solo slug della nostra lista, senza doppioni, al massimo 3; la condizione tagliata. */
export function cleanRecognition(
  raw: AssistantRecognitionOutput,
  allowedSlugs: ReadonlySet<string>,
): AssistantRecognition {
  const seen = new Set<string>();
  const candidates: AssistantCandidate[] = [];
  for (const candidate of raw.candidates) {
    const slug = candidate.slug.trim();
    if (!allowedSlugs.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    candidates.push({ slug, likelihood: candidate.likelihood });
    if (candidates.length === ASSISTANT_LIMITS.candidates) break;
  }
  return {
    photoUsable: raw.photoUsable,
    candidates,
    notInList: raw.notInList,
    condition: clip(raw.condition, ASSISTANT_LIMITS.conditionChars),
    looksUnhealthy: raw.photoUsable && raw.looksUnhealthy,
  };
}

export interface AssistantAnswer {
  readonly answer: string;
  readonly steps: readonly string[];
  readonly unsure: boolean;
  readonly askFlorist: boolean;
}

/** Risposta e passi entro i limiti; un passo vuoto si scarta. */
export function cleanAnswer(raw: AssistantAnswerOutput): AssistantAnswer {
  return {
    answer: clip(raw.answer, ASSISTANT_LIMITS.answerChars),
    steps: raw.steps
      .map((step) => clip(step, ASSISTANT_LIMITS.stepChars))
      .filter((step) => step !== '')
      .slice(0, ASSISTANT_LIMITS.steps),
    unsure: raw.unsure,
    askFlorist: raw.askFlorist || raw.unsure,
  };
}

// -----------------------------------------------------------------------------
// Prompt (versionati: la versione va in ogni chiamata registrata)
// -----------------------------------------------------------------------------

export const ASSISTANT_PROMPT_VERSION = 'v2';

/** La lingua in cui il modello scrive, con il nome che capisce meglio. */
const LANGUAGE_NAMES: Record<SupportedLocale, string> = {
  'es-MX': 'Spanish as spoken in Mexico',
  'it-IT': 'Italian',
  'en-US': 'English (US)',
};

export interface AssistantSpecies {
  readonly slug: string;
  /** Nome comune in es-MX (la lista del prompt è una sola, uguale per tutti: va in cache). */
  readonly name: string;
  readonly scientificName: string;
}

/** Il sistema del riconoscimento: regole e lista delle specie, uguale a ogni chiamata (cache). */
export function assistantRecognitionSystem(species: readonly AssistantSpecies[]): string {
  const list = species
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((item) => `${item.slug} | ${item.name} | ${item.scientificName}`)
    .join('\n');
  return [
    'You are the identification step of "Asistente de plantas", an assistant for indoor plants (in pots or planters) that a florist in Mexico cares for under a maintenance contract in homes, offices and hotels. The photo comes from the florist\'s customer.',
    'You receive one photo. Do three things:',
    '1. Identify the plant among the species in the LIST below. Return up to 3 candidates, best first, using only slugs from the LIST, each with a likelihood (high, medium or low). If the plant is clearly not in the LIST, set notInList to true and return only plausible candidates (or none).',
    '2. In `condition`, describe in at most two short sentences what is visibly notable about the plant: leaf color, spots, dry or brown tips, drooping, pests, mold, soil and pot or planter. Describe only what you see; do not guess causes and do not give advice.',
    '3. Set `looksUnhealthy` to true if the photo shows signs of a problem (yellow or brown leaves, spots, dry tips, drooping, pests, mold, rot), false if the plant looks healthy.',
    'If the photo does not clearly show a plant (too dark, blurry, not a plant), set photoUsable to false, return no candidates and explain why in `condition`.',
    'Write `condition` in the language requested in the message.',
    '',
    'LIST (slug | common name in Mexico | scientific name):',
    list,
  ].join('\n');
}

/** Il messaggio del riconoscimento (accanto alla foto). */
export function assistantRecognitionPrompt(input: {
  readonly locale: SupportedLocale;
  /** La specie della scheda della pianta, se c'è: solo un suggerimento. */
  readonly recordSlug: string | null;
}): string {
  return [
    `Write \`condition\` in ${LANGUAGE_NAMES[input.locale]}.`,
    input.recordSlug
      ? `The florist's record says this plant is "${input.recordSlug}". Treat it as a hint only: trust the photo.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Il sistema della risposta: le regole, uguali a ogni chiamata (cache). */
export function assistantAnswerSystem(): string {
  return [
    'You are "Asistente de plantas", a brief and careful assistant for indoor plants (in pots or planters) that a florist in Mexico cares for under a maintenance contract in homes, offices and hotels. You answer one question about one plant from the florist\'s customer, between the florist\'s visits.',
    'Rules:',
    '- Be brief: `answer` at most about 70 words; `steps` at most 4 short, concrete actions (or none if not needed).',
    '- Write in the language requested in the message. In Spanish always use the informal "tú".',
    '- If the photo description shows the plant in the ground or in a large planter, do not give pot-specific steps (saucer, drainage holes, moving the pot).',
    '- Use the species care data given in the message as the reference for that species. Never give fixed schedules ("water every 7 days"): explain how to check when the plant needs water or light.',
    '- Never give doses, concentrations, mixtures or brand names of pesticides, fungicides, fertilizers or other chemicals. If a product may be needed, say to ask their florist.',
    '- Do not talk about toxicity for people or pets: the app shows its own verified warning.',
    '- Base the answer only on the information given. If the symptoms are unclear, could have several causes, look serious or involve pests that can spread, say so, set `unsure` to true and set `askFlorist` to true (the customer can send the case to their florist).',
    '- If the question is not about caring for this plant, say briefly that you can only help with the plant and set `askFlorist` to true.',
  ].join('\n');
}

const LIGHT_TEXT: Record<PlantCare['light'], string> = {
  LOW: 'tolerates low light, but grows best in bright indirect light; no strong direct sun',
  MEDIUM: 'bright indirect light',
  HIGH: 'some direct sun during the day',
};
const WATERING_TEXT: Record<PlantCare['watering'], string> = {
  LITTLE: 'little water: let the soil dry out completely between waterings',
  DRY_BETWEEN: 'water when the top few centimeters of soil are dry',
  SLIGHTLY_MOIST: 'keep the soil slightly moist, never soggy',
};
const HUMIDITY_TEXT: Record<PlantCare['humidity'], string> = {
  LOW: 'low air humidity is fine',
  MEDIUM: 'medium air humidity',
  HIGH: 'likes high air humidity',
};

const KIND_TEXT: Record<AssistantQuestionKind, string> = {
  CARE: 'to know how to care for the plant (water, light, place)',
  PROBLEM: 'help with a problem they see on the plant',
};

export interface AssistantAnswerPromptInput {
  readonly locale: SupportedLocale;
  /** Che cosa vuole sapere chi chiede (non c'è nelle domande della prova pagata). */
  readonly kind?: AssistantQuestionKind;
  /** La specie confermata (null = «No sé»). */
  readonly species: (AssistantSpecies & { readonly care: PlantCare | null }) | null;
  /** La scheda della pianta nel contratto, se la consulta parte da lì. */
  readonly plant: {
    readonly size: string;
    readonly location: string | null;
    readonly light: string | null;
    readonly watering: string | null;
    readonly instructions: string | null;
  } | null;
  /** Ciò che il riconoscimento ha visto nella foto. */
  readonly condition: string;
  /** Domande e risposte precedenti dello stesso caso, già brevi. */
  readonly previous: readonly { readonly question: string; readonly answer: string }[];
  readonly question: string;
}

/** Il messaggio della risposta: dati della specie, della pianta, della foto e la domanda. */
export function assistantAnswerPrompt(input: AssistantAnswerPromptInput): string {
  const lines: string[] = [`Language: ${LANGUAGE_NAMES[input.locale]}.`];
  if (input.kind) lines.push(`The person wants: ${KIND_TEXT[input.kind]}.`);
  if (input.species) {
    lines.push(`Species: ${input.species.name} (${input.species.scientificName}).`);
    if (input.species.care) {
      lines.push(
        `Care data for this species: ${LIGHT_TEXT[input.species.care.light]}; ${WATERING_TEXT[input.species.care.watering]}; ${HUMIDITY_TEXT[input.species.care.humidity]}.`,
      );
    }
  } else {
    lines.push('Species: unknown (the person does not know it).');
  }
  if (input.plant) {
    const record = [
      `size ${input.plant.size.toLowerCase()}`,
      input.plant.location ? `location: ${clip(input.plant.location, 200)}` : null,
      input.plant.light ? `light: ${input.plant.light.toLowerCase()}` : null,
      input.plant.watering ? `watering notes: ${clip(input.plant.watering, 200)}` : null,
      input.plant.instructions
        ? `florist's instructions: ${clip(input.plant.instructions, 300)}`
        : null,
    ].filter((part): part is string => part !== null);
    lines.push(`Plant record from the florist: ${record.join('; ')}.`);
  }
  lines.push(`What the photo shows: ${input.condition || 'no description'}.`);
  for (const [index, previous] of input.previous.entries()) {
    lines.push(
      `Earlier question ${index + 1}: ${clip(previous.question, 200)} — earlier answer: ${clip(previous.answer, 300)}`,
    );
  }
  lines.push(`Question: ${input.question}`);
  return lines.join('\n');
}
