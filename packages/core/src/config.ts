/**
 * Configurazione della piattaforma (fase 0): le variabili d'ambiente usate dal core, con tutte le
 * regole che le legano fra loro, scritte UNA volta. È divisa in parti, una per adattatore:
 *  - AI (anteprime, scontorni, conteggio, stile);
 *  - archivio (foto e immagini);
 *  - email;
 *  - indirizzi (Google Places, ADR-059);
 *  - Asistente de plantas (Claude, ADR-085).
 * Ogni adattatore legge solo la sua parte, già validata. All'avvio l'app le controlla TUTTE
 * insieme (`platformConfigSchema`, vedi `apps/web/src/lib/config-check.ts`) e, se qualcosa non
 * va, non parte ed elenca tutti i problemi.
 *
 * Modulo leggero (solo `zod` e le costanti pure del dominio): si importa anche da
 * `@floral/core/config` senza caricare il resto del core. Elenco completo delle variabili: `docs/CONFIGURATION.md`.
 */
import { z } from 'zod';
import { ASSISTANT_LIMITS, ASSISTANT_MODELS, type AssistantModel } from '@floral/domain';

/** true se l'app gira solo in locale (sviluppo, test E2E): abilita gli adattatori locali. */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl) return true;
  try {
    const host = new URL(appUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Stringa facoltativa: vuota o di soli spazi conta come assente (righe `X=` del file .env). */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const DEFAULT_AI_MONTHLY_BUDGET_USD = 50;
/** Job AI in parallelo su tutta la piattaforma: sotto il limite di fal (10 richieste contemporanee). */
const DEFAULT_AI_MAX_CONCURRENT_JOBS = 8;
const MAX_AI_CONCURRENT_JOBS = 50;
/** Lunghezza minima del segreto che protegge i job su funzioni (coda AI, manutenzione). */
const MIN_CRON_SECRET_LENGTH = 32;
const R2_VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

type RefinementContext = z.RefinementCtx;

// --- AI ----------------------------------------------------------------------------------------

const aiFields = {
  APP_URL: optionalText,
  AI_PROVIDER: z.enum(['none', 'simulated', 'fal']).default('none'),
  AI_MODEL: optionalText,
  FAL_KEY: optionalText,
  // Numeri come testo qui, controllati nelle regole: così un valore sbagliato non nasconde gli altri
  // problemi (le regole fra variabili non girano se un campo fallisce).
  AI_MONTHLY_BUDGET_USD: optionalText,
  AI_MAX_CONCURRENT_JOBS: optionalText,
  // Motore dei job AI: `inline` = ciclo nel processo del server (locale, container);
  // `serverless` = funzione avviata a richiesta (Vercel). Predefinito: serverless su Vercel.
  AI_WORKER_MODE: z.enum(['inline', 'serverless']).optional(),
  // Segreto che protegge i job su funzioni: coda AI e manutenzione giornaliera (anche Vercel Cron).
  CRON_SECRET: optionalText,
  // Impostata da Vercel in ogni deploy.
  VERCEL: optionalText,
  // Impostata da Vercel: dominio di produzione del progetto, senza `https://` (es.
  // `gardelia.vercel.app`). L'avvio dei job AI chiama sempre questo, mai APP_URL (porta il segreto).
  VERCEL_PROJECT_PRODUCTION_URL: optionalText,
};

/** Tetto mensile in USD: predefinito se assente; `null` se non è un importo valido. */
function budgetUsd(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_AI_MONTHLY_BUDGET_USD;
  const usd = Number(value);
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/** Job AI in parallelo: predefinito se assente; `null` se non è un intero fra 1 e 50. */
function maxConcurrentJobs(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_AI_MAX_CONCURRENT_JOBS;
  const jobs = Number(value);
  return Number.isInteger(jobs) && jobs >= 1 && jobs <= MAX_AI_CONCURRENT_JOBS ? jobs : null;
}

export type AiWorkerMode = 'inline' | 'serverless';

function workerMode(config: {
  AI_WORKER_MODE?: AiWorkerMode | undefined;
  VERCEL?: string | undefined;
}): AiWorkerMode {
  return config.AI_WORKER_MODE ?? (config.VERCEL ? 'serverless' : 'inline');
}

type AiTextValues = {
  AI_MONTHLY_BUDGET_USD?: string | undefined;
  AI_MAX_CONCURRENT_JOBS?: string | undefined;
  AI_WORKER_MODE?: AiWorkerMode | undefined;
  VERCEL?: string | undefined;
};

/** Converte numeri e motore dopo le regole (un valore non valido è già un errore). */
function withAiValues<T extends AiTextValues>(
  config: T,
): Omit<T, 'AI_MONTHLY_BUDGET_USD' | 'AI_MAX_CONCURRENT_JOBS' | 'AI_WORKER_MODE'> & {
  AI_MONTHLY_BUDGET_USD: number;
  AI_MAX_CONCURRENT_JOBS: number;
  AI_WORKER_MODE: AiWorkerMode;
} {
  return {
    ...config,
    AI_MONTHLY_BUDGET_USD: budgetUsd(config.AI_MONTHLY_BUDGET_USD) ?? DEFAULT_AI_MONTHLY_BUDGET_USD,
    AI_MAX_CONCURRENT_JOBS:
      maxConcurrentJobs(config.AI_MAX_CONCURRENT_JOBS) ?? DEFAULT_AI_MAX_CONCURRENT_JOBS,
    AI_WORKER_MODE: workerMode(config),
  };
}

function aiRules(
  config: AiTextValues & {
    APP_URL?: string | undefined;
    AI_PROVIDER: string;
    FAL_KEY?: string | undefined;
    CRON_SECRET?: string | undefined;
  },
  ctx: RefinementContext,
): void {
  if (maxConcurrentJobs(config.AI_MAX_CONCURRENT_JOBS) === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_MAX_CONCURRENT_JOBS'],
      message: `deve essere un numero intero fra 1 e ${MAX_AI_CONCURRENT_JOBS}`,
    });
  }
  // Su funzioni (Vercel) il segreto protegge la coda AI e la manutenzione giornaliera (scadenze):
  // serve anche senza provider AI.
  if (
    workerMode(config) === 'serverless' &&
    (config.CRON_SECRET?.length ?? 0) < MIN_CRON_SECRET_LENGTH
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['CRON_SECRET'],
      message: `obbligatoria su Vercel (job AI e manutenzione giornaliera), almeno ${MIN_CRON_SECRET_LENGTH} caratteri (openssl rand -hex 32)`,
    });
  }
  if (budgetUsd(config.AI_MONTHLY_BUDGET_USD) === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_MONTHLY_BUDGET_USD'],
      message: 'deve essere un importo in USD ≥ 0',
    });
  }
  if (config.AI_PROVIDER === 'simulated' && !isLocalAppUrl(config.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_PROVIDER'],
      message:
        'simulated è ammesso solo in locale: con un APP_URL pubblico non si mostrano anteprime simulate',
    });
  }
  if (config.AI_PROVIDER === 'fal' && !config.FAL_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['FAL_KEY'],
      message: 'obbligatoria con AI_PROVIDER=fal (nelle variabili dell’hosting, mai nel repo)',
    });
  }
}

export const aiConfigSchema = z.object(aiFields).superRefine(aiRules).transform(withAiValues);
export type AiConfig = z.infer<typeof aiConfigSchema>;

// --- Archivio ----------------------------------------------------------------------------------

const storageFields = {
  APP_URL: optionalText,
  STORAGE_DRIVER: z.enum(['filesystem', 'r2']).default('filesystem'),
  STORAGE_DIR: optionalText,
  R2_ACCOUNT_ID: optionalText,
  R2_BUCKET: optionalText,
  R2_ACCESS_KEY_ID: optionalText,
  R2_SECRET_ACCESS_KEY: optionalText,
};

function storageRules(
  config: { APP_URL?: string | undefined; STORAGE_DRIVER: string } & Partial<
    Record<(typeof R2_VARIABLES)[number], string | undefined>
  >,
  ctx: RefinementContext,
): void {
  if (config.STORAGE_DRIVER === 'filesystem' && !isLocalAppUrl(config.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DRIVER'],
      message: 'filesystem è ammesso solo in locale: con un APP_URL pubblico usa r2',
    });
  }
  if (config.STORAGE_DRIVER === 'r2') {
    for (const name of R2_VARIABLES) {
      if (!config[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'obbligatoria con STORAGE_DRIVER=r2',
        });
      }
    }
  }
}

export const storageConfigSchema = z.object(storageFields).superRefine(storageRules);
export type StorageConfig = z.infer<typeof storageConfigSchema>;

// --- Email -------------------------------------------------------------------------------------

const emailFields = {
  NODE_ENV: optionalText,
  SMTP_URL: optionalText,
  EMAIL_FROM: optionalText,
};

function emailRules(
  config: { NODE_ENV?: string | undefined; SMTP_URL?: string | undefined },
  ctx: RefinementContext,
): void {
  // In sviluppo, senza SMTP le email finiscono nel log; in produzione servono davvero.
  if (config.NODE_ENV === 'production' && !config.SMTP_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_URL'],
      message: 'obbligatoria in produzione: senza un provider email non partono verifiche e inviti',
    });
  }
}

export const emailConfigSchema = z.object(emailFields).superRefine(emailRules);
export type EmailConfig = z.infer<typeof emailConfigSchema>;

// --- Indirizzi (Google Places, ADR-059) ----------------------------------------------------------

const placesFields = {
  // Chiave di Google Maps Platform con la sola "Places API (New)" abilitata. Solo lato server: il
  // browser chiede i suggerimenti alla nostra app, mai a Google. Assente: indirizzi scritti a mano.
  GOOGLE_MAPS_API_KEY: optionalText,
};

function placesRules(config: { GOOGLE_MAPS_API_KEY?: string | undefined }, ctx: RefinementContext) {
  const key = config.GOOGLE_MAPS_API_KEY;
  // Le chiavi di Google sono di 39 caratteri: un valore molto diverso è quasi sempre un errore.
  if (key && !/^[A-Za-z0-9_-]{30,60}$/.test(key)) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_MAPS_API_KEY'],
      message: 'non sembra una chiave di Google Maps Platform (lettere, numeri, - e _)',
    });
  }
}

export const placesConfigSchema = z.object(placesFields).superRefine(placesRules);

// --- Asistente de plantas (ADR-085) ------------------------------------------------------------

const assistantFields = {
  APP_URL: optionalText,
  // `anthropic` = Claude con l'SDK ufficiale; `simulated` = risposte finte, solo in locale e nei
  // test (etichettate); `none` = assistente spento (i link non compaiono).
  ASSISTANT_PROVIDER: z.enum(['none', 'simulated', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: optionalText,
  // Mix scelto dal founder dopo la prova (docs/AI_BENCHMARK.md): il modello principale riconosce
  // la foto e risponde ai problemi, quello leggero alle domande di cura.
  ASSISTANT_MODEL: optionalText,
  ASSISTANT_CARE_MODEL: optionalText,
  // Tetto mensile di spesa dell'assistente su tutta la piattaforma, in USD (rete di sicurezza:
  // i crediti li paga la fioreria; fuori dal tetto delle immagini).
  ASSISTANT_MONTHLY_BUDGET_USD: optionalText,
};

const DEFAULT_ASSISTANT_MODEL: AssistantModel = 'claude-opus-5-5';
const DEFAULT_ASSISTANT_CARE_MODEL: AssistantModel = 'claude-haiku-5-5';

function assistantBudgetUsd(value: string | undefined): number | null {
  if (value === undefined) return ASSISTANT_LIMITS.defaultMonthlyBudgetUsd;
  const usd = Number(value);
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

function assistantRules(
  config: {
    APP_URL?: string | undefined;
    ASSISTANT_PROVIDER: string;
    ANTHROPIC_API_KEY?: string | undefined;
    ASSISTANT_MODEL?: string | undefined;
    ASSISTANT_CARE_MODEL?: string | undefined;
    ASSISTANT_MONTHLY_BUDGET_USD?: string | undefined;
  },
  ctx: RefinementContext,
): void {
  if (config.ASSISTANT_PROVIDER === 'simulated' && !isLocalAppUrl(config.APP_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['ASSISTANT_PROVIDER'],
      message:
        'simulated è ammesso solo in locale: con un APP_URL pubblico non si mostrano risposte simulate',
    });
  }
  if (config.ASSISTANT_PROVIDER === 'anthropic' && !config.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message:
        'obbligatoria con ASSISTANT_PROVIDER=anthropic (nelle variabili dell’hosting, mai nel repo)',
    });
  }
  for (const key of ['ASSISTANT_MODEL', 'ASSISTANT_CARE_MODEL'] as const) {
    const model = config[key];
    if (model !== undefined && !(ASSISTANT_MODELS as readonly string[]).includes(model)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `deve essere uno di: ${ASSISTANT_MODELS.join(', ')}`,
      });
    }
  }
  if (assistantBudgetUsd(config.ASSISTANT_MONTHLY_BUDGET_USD) === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['ASSISTANT_MONTHLY_BUDGET_USD'],
      message: 'deve essere un importo in USD ≥ 0',
    });
  }
}

function modelOr(value: string | undefined, fallback: AssistantModel): AssistantModel {
  return (ASSISTANT_MODELS as readonly string[]).includes(value ?? '')
    ? (value as AssistantModel)
    : fallback;
}

/** Converte modelli e budget dopo le regole (un valore non valido è già un errore). */
function withAssistantValues<
  T extends {
    ASSISTANT_MODEL?: string | undefined;
    ASSISTANT_CARE_MODEL?: string | undefined;
    ASSISTANT_MONTHLY_BUDGET_USD?: string | undefined;
  },
>(
  config: T,
): Omit<T, 'ASSISTANT_MODEL' | 'ASSISTANT_CARE_MODEL' | 'ASSISTANT_MONTHLY_BUDGET_USD'> & {
  ASSISTANT_MODEL: AssistantModel;
  ASSISTANT_CARE_MODEL: AssistantModel;
  ASSISTANT_MONTHLY_BUDGET_USD: number;
} {
  return {
    ...config,
    ASSISTANT_MODEL: modelOr(config.ASSISTANT_MODEL, DEFAULT_ASSISTANT_MODEL),
    ASSISTANT_CARE_MODEL: modelOr(config.ASSISTANT_CARE_MODEL, DEFAULT_ASSISTANT_CARE_MODEL),
    ASSISTANT_MONTHLY_BUDGET_USD:
      assistantBudgetUsd(config.ASSISTANT_MONTHLY_BUDGET_USD) ??
      ASSISTANT_LIMITS.defaultMonthlyBudgetUsd,
  };
}

export const assistantConfigSchema = z
  .object(assistantFields)
  .superRefine(assistantRules)
  .transform(withAssistantValues);
export type AssistantConfig = z.infer<typeof assistantConfigSchema>;

// --- Tutto insieme (controllo all'avvio) -------------------------------------------------------

export const platformConfigSchema = z
  .object({ ...aiFields, ...storageFields, ...emailFields, ...placesFields, ...assistantFields })
  .superRefine((config, ctx) => {
    aiRules(config, ctx);
    storageRules(config, ctx);
    emailRules(config, ctx);
    placesRules(config, ctx);
    assistantRules(config, ctx);
  })
  .transform((config) => withAssistantValues(withAiValues(config)));
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Problemi di configurazione leggibili: `VARIABILE: cosa non va` (mai i valori). */
export function configIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

export class ConfigurationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configurazione non valida:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigurationError';
  }
}

function parseConfig<T>(schema: z.ZodType<T>, env: EnvSource): T {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new ConfigurationError(configIssues(parsed.error));
  return parsed.data;
}

/**
 * Lettore di una parte della configurazione: con l'ambiente del processo la legge una volta sola;
 * con un ambiente esplicito (test) la valida ogni volta.
 */
function configReader<T>(schema: z.ZodType<T>): (env?: EnvSource) => T {
  let cached: T | undefined;
  return (env) => {
    if (env !== undefined && env !== process.env) return parseConfig(schema, env);
    cached ??= parseConfig(schema, process.env);
    return cached;
  };
}

/** Parte AI: provider, modello, chiave fal, tetto di spesa. */
export const aiConfig = configReader(aiConfigSchema);
/** Parte archivio: driver e credenziali R2. */
export const storageConfig = configReader(storageConfigSchema);
/** Parte email: SMTP e mittente. */
export const emailConfig = configReader(emailConfigSchema);

export const placesConfig = configReader(placesConfigSchema);
/** Parte dell'Asistente de plantas: provider, chiave Anthropic, modello, budget (ADR-085). */
export const assistantConfig = configReader(assistantConfigSchema);

/** Tutta la configurazione della piattaforma, validata insieme. */
export function readPlatformConfig(env: EnvSource = process.env): PlatformConfig {
  return parseConfig(platformConfigSchema, env);
}
