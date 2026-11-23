import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { Button } from '@/components/ui/button';
import { accountRoutes, buyerRoutes, withQuery } from '@/lib/routes';
import { getSession } from '@/lib/session';

/**
 * Intestazione delle pagine per chi compra (home e ricerca, ADR-066): marchio, "Para florerías",
 * accesso o "Mi cuenta", lingua.
 */
export async function BuyerHeader() {
  const t = await getTranslations('home');
  const session = await getSession();
  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl justify-end px-4 pt-3">
        <LanguageSwitcher />
      </div>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href={buyerRoutes.home} className="inline-flex">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          {/* Su telefono "Para florerías" è in fondo alla home: l'intestazione resta su una riga. */}
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={buyerRoutes.florists}>{t('forFlorists')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link
              href={
                session ? accountRoutes.home : withQuery('/login', { next: accountRoutes.home })
              }
            >
              {session ? t('myAccount') : t('signIn')}
            </Link>
          </Button>
        </nav>
      </header>
    </>
  );
}
