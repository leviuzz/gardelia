import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { resolveLocale } from '@floral/domain';
import { LOCALE_COOKIE } from './locale';

/**
 * Configurazione i18n per richiesta (ADR-042). La lingua è quella chiesta esplicitamente dal
 * codice (es. `getTranslations({ locale: 'es-MX' })` per il messaggio WhatsApp al cliente, sempre
 * nella lingua della fioreria); altrimenti quella del cookie scelto dalla persona; senza cookie, o
 * con un valore sconosciuto, es-MX.
 */
export default getRequestConfig(async ({ locale: explicit }) => {
  const locale = resolveLocale(explicit ?? (await cookies()).get(LOCALE_COOKIE)?.value);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: 'America/Mexico_City' };
});
