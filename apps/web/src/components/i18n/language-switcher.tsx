import { Languages } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ENABLED_LOCALES, LOCALE_NAMES } from '@floral/domain';
import { changeLocaleAction } from '@/i18n/actions';
import { cn } from '@/lib/utils';

/**
 * Selettore della lingua per le pagine senza menu dell'account (accesso, registrazione, invito,
 * onboarding, pagina iniziale). È un modulo con un pulsante per lingua: funziona anche prima che
 * il JavaScript sia caricato.
 */
export async function LanguageSwitcher({ className }: { readonly className?: string }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common')]);
  return (
    <form
      action={changeLocaleAction}
      aria-label={t('language')}
      className={cn('flex items-center gap-1 text-xs', className)}
    >
      <Languages className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {ENABLED_LOCALES.map((code) => (
        <button
          key={code}
          type="submit"
          name="locale"
          value={code}
          lang={code}
          aria-pressed={code === locale}
          className={cn(
            'rounded-md px-1.5 py-1 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
            code === locale && 'font-semibold text-foreground',
          )}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </form>
  );
}
