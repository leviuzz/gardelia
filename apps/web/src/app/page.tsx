import { MapPin, MessageCircle, Search, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getPlacesProvider, listBuyerSearchAddresses, listPublicStoreCities } from '@floral/core';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { BuyerHeader } from '@/components/public/buyer-header';
import { HomeAddressSearch } from '@/components/public/home-address-search';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { accountRoutes, buyerRoutes, withQuery } from '@/lib/routes';
import { getSession } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  return { title: t('metaTitle'), description: t('subtitle') };
}

/**
 * Home per chi compra fiori (marketplace, blocco C3, ADR-066): si sceglie dove mandare i fiori e si
 * trovano le fiorerie che consegnano lì. Per tutti la scelta della città; con l'accesso anche la
 * ricerca dell'indirizzo con Google (costa: mai per visitatori anonimi) e gli indirizzi salvati.
 */
export default async function BuyerHomePage() {
  const t = await getTranslations('home');
  const session = await getSession();
  const [cities, saved] = await Promise.all([
    listPublicStoreCities(),
    session ? listBuyerSearchAddresses({ userId: session.user.id, country: 'MX' }) : [],
  ]);
  const addressSearch = session !== null && getPlacesProvider() !== null;

  const steps = [
    { icon: Search, title: t('step1Title'), body: t('step1Body') },
    { icon: Store, title: t('step2Title'), body: t('step2Body') },
    { icon: MessageCircle, title: t('step3Title'), body: t('step3Body') },
  ];

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.03_12),transparent_60%)]">
      <BuyerHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:pt-14">
        <section className="max-w-2xl">
          <h1 className="font-display text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{t('subtitle')}</p>
        </section>

        <section
          aria-labelledby="where"
          className="mt-8 max-w-2xl space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <h2 id="where" className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="size-5 text-primary" aria-hidden="true" />
            {t('whereTitle')}
          </h2>

          {addressSearch ? (
            <PlacesConfigProvider enabled near={null}>
              <HomeAddressSearch />
            </PlacesConfigProvider>
          ) : null}

          {saved.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t('savedAddresses')}</p>
              <ul className="flex flex-wrap gap-2">
                {saved.map((address) => (
                  <li key={address.id}>
                    <Button asChild variant="outline" size="sm">
                      <Link href={buyerRoutes.search({ direccion: address.id })}>
                        <MapPin />
                        {address.label}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {cities.length > 0 ? (
            <form
              method="get"
              action={buyerRoutes.search()}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <label className="grid flex-1 gap-2 text-sm font-medium">
                {addressSearch || saved.length > 0 ? t('orCity') : t('city')}
                <NativeSelect name="ciudad" defaultValue={cities[0]} required>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <Button type="submit">
                <Search />
                {t('search')}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noStoresYet')}</p>
          )}

          {session ? null : (
            <p className="text-sm text-muted-foreground">
              {t('signInForAddress')}{' '}
              <Link
                href={withQuery('/login', { next: accountRoutes.home })}
                className="font-medium text-primary hover:underline"
              >
                {t('signIn')}
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="how" className="mt-14">
          <h2 id="how" className="font-display text-2xl font-semibold">
            {t('howTitle')}
          </h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {steps.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="rounded-2xl border bg-card/80 p-5 shadow-xs">
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-semibold">
                  {index + 1}. {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 flex flex-col items-start gap-3 rounded-2xl border bg-secondary/40 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t('floristTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('floristBody')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={buyerRoutes.florists}>{t('floristCta')}</Link>
          </Button>
        </section>
      </main>
    </div>
  );
}
