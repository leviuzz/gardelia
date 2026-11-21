import 'server-only';
import { z } from 'zod';

/**
 * Variabili d'ambiente lato server, validate all'avvio (fail fast).
 * Nessun segreto ha un valore di default nel codice.
 */
const isProduction = process.env.NODE_ENV === 'production';

const schema = z.object({
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET deve avere almeno 32 caratteri (openssl rand -base64 32)'),
  BETTER_AUTH_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1),
  SMTP_URL: isProduction
    ? z.string().min(1, 'SMTP_URL è obbligatoria in produzione')
    : z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  TRUSTED_IP_HEADER: z.string().default('x-forwarded-for'),
  // Anteprime AI e archivio (ADR-025): la coerenza con APP_URL è verificata all'avvio da
  // @floral/core (provider simulato e archivio locale solo in locale).
  AI_PROVIDER: z.enum(['none', 'simulated']).default('none'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(50),
  STORAGE_DRIVER: z.enum(['filesystem', 'r2']).default('filesystem'),
  STORAGE_DIR: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configurazione non valida:\n  - ${details.join('\n  - ')}`);
  }
  cached = parsed.data;
  return cached;
}
