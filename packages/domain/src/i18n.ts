/**
 * Lingue dell'interfaccia. es-MX è la lingua di lancio (completa);
 * it-IT ed en-US sono predisposte ma non attivabili finché le traduzioni non sono complete.
 */
export const DEFAULT_LOCALE = 'es-MX';
export const SUPPORTED_LOCALES = ['es-MX', 'it-IT', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const ENABLED_LOCALES: readonly SupportedLocale[] = ['es-MX'];

export function resolveLocale(candidate: string | null | undefined): SupportedLocale {
  if (candidate && (ENABLED_LOCALES as readonly string[]).includes(candidate)) {
    return candidate as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}
