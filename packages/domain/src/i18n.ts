/**
 * Lingue dell'interfaccia (ADR-042). es-MX è la lingua predefinita e quella del mercato: fioristi e
 * clienti in Messico non vedono cambiamenti. it-IT ed en-US le sceglie ogni persona (founder,
 * tester); ogni testo esiste nelle tre lingue (test di parità dei messaggi). Ciò che arriva al
 * cliente finale (email, messaggio WhatsApp) resta nella lingua del mercato della fioreria.
 */
export const DEFAULT_LOCALE = 'es-MX';
export const SUPPORTED_LOCALES = ['es-MX', 'it-IT', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const ENABLED_LOCALES: readonly SupportedLocale[] = SUPPORTED_LOCALES;

/** Nome di ogni lingua nella lingua stessa (selettore): non si traduce. */
export const LOCALE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'es-MX': 'Español',
  'it-IT': 'Italiano',
  'en-US': 'English',
};

export function isEnabledLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (ENABLED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(candidate: string | null | undefined): SupportedLocale {
  return isEnabledLocale(candidate) ? candidate : DEFAULT_LOCALE;
}
