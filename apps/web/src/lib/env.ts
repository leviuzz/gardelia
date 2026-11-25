import 'server-only';
import { z } from 'zod';
import { ConfigurationError, configIssues } from '@floral/core/config';

/**
 * Variabili d'ambiente proprie del server web (login, URL, database), validate all'avvio insieme
 * a quelle della piattaforma (AI, archivio, email: `@floral/core/config`). Vedi
 * `lib/config-check.ts` e l'elenco completo in `docs/CONFIGURATION.md`.
 * Nessun segreto ha un valore di default nel codice.
 */

/** Stringa facoltativa: vuota o di soli spazi conta come assente (righe `X=` del file .env). */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

/**
 * Numero WhatsApp con il prefisso internazionale (E.164): spazi, trattini e parentesi si tolgono,
 * così si può incollare com'è ("+39 348 …"). Senza "+" non si sa di che paese è: errore.
 */
const optionalWhatsapp = optionalText.pipe(
  z
    .string()
    .transform((value) => value.replace(/[\s().-]/g, ''))
    .pipe(
      z
        .string()
        .regex(/^\+\d{8,15}$/, 'numero completo con il prefisso del paese, es. +52 449 123 4567'),
    )
    .optional(),
);

export const serverEnvSchema = z
  .object({
    APP_URL: z.url(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'deve avere almeno 32 caratteri (generala con: openssl rand -base64 32)'),
    BETTER_AUTH_URL: z.url().optional(),
    DATABASE_URL: z.string().min(1),
    TRUSTED_IP_HEADER: z.string().default('x-forwarded-for'),
    // Login con Google (ADR-036): facoltativo, entrambe le chiavi o nessuna.
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    // Fase di prova (D-29): WhatsApp della piattaforma per comprare i crediti delle immagini AI.
    PLATFORM_WHATSAPP: optionalWhatsapp,
    // Google (M1-2, ADR-087): `on` solo nel progetto di produzione; spento, ogni pagina è
    // `noindex` e robots.txt chiude tutto (staging resta nascosto).
    PUBLIC_INDEXING: optionalText.pipe(z.enum(['on', 'off']).default('off')),
  })
  .superRefine((env, ctx) => {
    // Una sola delle due chiavi Google è quasi sempre un errore di configurazione: meglio
    // non partire che mostrare un pulsante che fallisce.
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET vanno impostate insieme (o nessuna)',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Credenziali del client OAuth di Google, se il login con Google è configurato. */
export function googleCredentials(
  env: Pick<ServerEnv, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>,
): { clientId: string; clientSecret: string } | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/** Il pulsante "Continuar con Google" si mostra solo se il login con Google è configurato. */
export function isGoogleLoginEnabled(): boolean {
  return googleCredentials(serverEnv()) !== null;
}

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) throw new ConfigurationError(configIssues(parsed.error));
  cached = parsed.data;
  return cached;
}
