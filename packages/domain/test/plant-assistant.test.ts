import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_LIMITS,
  ASSISTANT_MODELS,
  assistantAnswerPrompt,
  assistantAnswerSystem,
  assistantCallCostMicros,
  assistantDayStart,
  assistantEstimatedCostMicros,
  assistantQuestionSchema,
  assistantRecognitionPrompt,
  assistantRecognitionSystem,
  cleanAnswer,
  cleanRecognition,
  isAssistantModel,
  parsePlantCare,
} from '../src/index';

/** Floral Care, blocco 6 (ADR-085): le regole pure dell'Asistente de plantas. */
describe('Asistente de plantas: costo dai token veri', () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  it('listino per modello, in micro-USD (verificato sulla pagina dei prezzi)', () => {
    expect(assistantCallCostMicros('claude-opus-5-5', usage)).toBe(4_000_000);
    expect(assistantCallCostMicros('claude-sonnet-5-5', usage)).toBe(2_000_000);
    expect(assistantCallCostMicros('claude-haiku-5-5', { ...usage, inputTokens: 100_000 })).toBe(
      10_000,
    );
    // Uscita, scrittura e lettura della cache.
    expect(
      assistantCallCostMicros('claude-opus-5-5', {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheCreationTokens: 2_000,
        cacheReadTokens: 10_000,
      }),
    ).toBe(4_000 + 10_000 + 10_000 + 2_000);
  });

  it('Haiku oltre i 100.000 token di richiesta (cache compresa) usa il secondo listino', () => {
    const cost = assistantCallCostMicros('claude-haiku-5-5', {
      inputTokens: 60_000,
      outputTokens: 1_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 50_000,
    });
    expect(cost).toBe(30_000 + 2_500 + 2_500);
  });

  it('un modello del fallback si paga con il suo listino; uno sconosciuto come Opus 5', () => {
    expect(assistantCallCostMicros('claude-sonnet-5', usage)).toBe(2_000_000);
    expect(assistantCallCostMicros('claude-opus-4-8', usage)).toBe(5_000_000);
    expect(assistantCallCostMicros('claude-nuevo', usage)).toBe(5_000_000);
  });

  it('arrotonda per eccesso e stima una chiamata in modo prudente', () => {
    expect(
      assistantCallCostMicros('claude-haiku-5-5', {
        inputTokens: 1,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(1);
    for (const model of ASSISTANT_MODELS) {
      expect(assistantEstimatedCostMicros(model)).toBeGreaterThan(0);
    }
    expect(assistantEstimatedCostMicros('claude-opus-5-5')).toBe(42_000);
    expect(isAssistantModel('claude-opus-5-5')).toBe(true);
    expect(isAssistantModel('gpt-4')).toBe(false);
  });

  it('il giorno dei limiti è quello della fioreria', () => {
    const start = assistantDayStart('America/Mexico_City', new Date('2026-11-25T05:30:00Z'));
    // Alle 23:30 del 24 a Città del Messico il giorno è ancora il 24.
    expect(start.toISOString()).toBe('2026-11-24T06:00:00.000Z');
  });
});

describe('Asistente de plantas: domanda e output del modello', () => {
  it('domanda ripulita, obbligatoria, al massimo 500 caratteri; specie vuota = «No sé»', () => {
    expect(
      assistantQuestionSchema.parse({
        question: '  ¿Por qué tiene hojas amarillas? ',
        speciesSlug: '',
      }),
    ).toEqual({ question: '¿Por qué tiene hojas amarillas?', speciesSlug: null });
    expect(assistantQuestionSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(
      assistantQuestionSchema.safeParse({ question: 'a'.repeat(ASSISTANT_LIMITS.question + 1) })
        .success,
    ).toBe(false);
    expect(
      assistantQuestionSchema.parse({ question: 'Hola', speciesSlug: 'telefono' }).speciesSlug,
    ).toBe('telefono');
  });

  it('del riconoscimento restano solo specie della lista, senza doppioni, al massimo 3', () => {
    const allowed = new Set(['telefono', 'monstera', 'filodendro', 'calathea']);
    const clean = cleanRecognition(
      {
        photoUsable: true,
        candidates: [
          { slug: 'telefono', likelihood: 'high' },
          { slug: 'rosa', likelihood: 'medium' },
          { slug: 'telefono', likelihood: 'low' },
          { slug: ' filodendro ', likelihood: 'medium' },
          { slug: 'monstera', likelihood: 'low' },
          { slug: 'calathea', likelihood: 'low' },
        ],
        notInList: false,
        condition: `  Hojas   amarillas ${'x'.repeat(400)}`,
      },
      allowed,
    );
    expect(clean.candidates.map((candidate) => candidate.slug)).toEqual([
      'telefono',
      'filodendro',
      'monstera',
    ]);
    expect(clean.condition.startsWith('Hojas amarillas')).toBe(true);
    expect(clean.condition.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.conditionChars);
  });

  it('della risposta al massimo 5 passi non vuoti; se non è sicura consiglia la fioreria', () => {
    const clean = cleanAnswer({
      answer: 'Riega menos.',
      steps: ['Uno', '  ', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'],
      unsure: true,
      askFlorist: false,
    });
    expect(clean.steps).toEqual(['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']);
    expect(clean.askFlorist).toBe(true);
  });
});

describe('Asistente de plantas: prompt', () => {
  const species = [
    { slug: 'telefono', name: 'Teléfono', scientificName: 'Epipremnum aureum' },
    { slug: 'calathea', name: 'Calathea', scientificName: 'Goeppertia spp.' },
  ];

  it('il sistema del riconoscimento è stabile (cache) e contiene la lista e le regole', () => {
    const system = assistantRecognitionSystem(species);
    expect(system).toBe(assistantRecognitionSystem([...species].reverse()));
    expect(system).toContain('calathea | Calathea | Goeppertia spp.');
    expect(system).toContain('telefono | Teléfono | Epipremnum aureum');
    expect(system).toContain('only slugs from the LIST');
    expect(assistantRecognitionPrompt({ locale: 'it-IT', recordSlug: 'telefono' })).toContain(
      'Italian',
    );
    expect(assistantRecognitionPrompt({ locale: 'es-MX', recordSlug: null })).not.toContain(
      'record',
    );
  });

  it('le regole della risposta vietano dosi e frasi sulla tossicità', () => {
    const system = assistantAnswerSystem();
    expect(system).toContain('Never give doses');
    expect(system).toContain('Do not talk about toxicity');
    expect(system).toContain('Never give fixed schedules');
  });

  it('la domanda porta specie, dati di cura, scheda, foto e risposte precedenti', () => {
    const care = parsePlantCare({
      light: 'LOW',
      watering: 'DRY_BETWEEN',
      humidity: 'MEDIUM',
      petToxicity: 'TOXIC',
      toxicitySource: 'ASPCA',
      reviewed: false,
    });
    const prompt = assistantAnswerPrompt({
      locale: 'es-MX',
      species: { ...species[0]!, care },
      plant: {
        size: 'MEDIUM',
        location: 'Recepción',
        light: 'LOW',
        watering: null,
        instructions: 'No mover',
      },
      condition: 'Hojas amarillas en la base.',
      previous: [{ question: '¿Riego?', answer: 'Menos.' }],
      question: '¿Y la luz?',
    });
    expect(prompt).toContain('Spanish as spoken in Mexico');
    expect(prompt).toContain('Teléfono (Epipremnum aureum)');
    expect(prompt).toContain('tolerates low light');
    expect(prompt).toContain('location: Recepción');
    expect(prompt).toContain('Hojas amarillas en la base.');
    expect(prompt).toContain('Earlier question 1: ¿Riego?');
    expect(prompt.endsWith('Question: ¿Y la luz?')).toBe(true);
    expect(prompt).not.toContain('TOXIC');
    expect(
      assistantAnswerPrompt({
        locale: 'en-US',
        species: null,
        plant: null,
        condition: '',
        previous: [],
        question: 'Help',
      }),
    ).toContain('Species: unknown');
  });
});

describe('dati di cura delle piante', () => {
  it('valori validi passano, il resto diventa null senza eccezioni', () => {
    expect(
      parsePlantCare({
        light: 'HIGH',
        watering: 'LITTLE',
        humidity: 'LOW',
        petToxicity: 'VARIES',
        toxicitySource: null,
        reviewed: false,
      }),
    ).not.toBeNull();
    expect(parsePlantCare(null)).toBeNull();
    expect(parsePlantCare({ light: 'HIGH' })).toBeNull();
    expect(
      parsePlantCare({
        light: 'HIGH',
        watering: 'LITTLE',
        humidity: 'LOW',
        petToxicity: 'TOXIC',
        toxicitySource: 'ASPCA',
        reviewed: false,
        extra: 1,
      }),
    ).toBeNull();
  });
});
