/**
 * Lingua dell'interfaccia scelta dalla persona (ADR-042): un cookie per browser, letto a ogni
 * richiesta da `i18n/request.ts`. Senza cookie: es-MX. Modulo puro (nessun accesso a Next.js).
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Un anno: la scelta resta finché la persona non la cambia. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
