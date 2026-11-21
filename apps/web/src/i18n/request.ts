import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, resolveLocale } from '@floral/domain';

/**
 * Configurazione i18n per richiesta. Al lancio l'unica lingua abilitata è es-MX;
 * quando it-IT/en-US saranno complete, la lingua verrà presa dalla preferenza dell'utente.
 */
export default getRequestConfig(async () => {
  const locale = resolveLocale(DEFAULT_LOCALE);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: 'America/Mexico_City' };
});
