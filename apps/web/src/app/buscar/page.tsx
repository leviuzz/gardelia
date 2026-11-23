import { ArrowLeft, Flower2, MapPin, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listBuyerSearchAddresses, searchPublicStores, type DirectoryStoreDto } from '@floral/core';
import { LegalLinks } from '@/components/legal/legal-links';
import { BuyerHeader } from '@/components/public/buyer-header';
import { Button } from '@/components/ui/button';
import { buyerRoutes, publicStoreRoutes } from '@/lib/routes';
import { getSession } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Fiorerie che consegnano dove chiede chi compra (marketplace, blocco C3, ADR-066): prima quelle
 * che arrivano a quell'indirizzo, dalla più vicina; poi quelle della stessa città di cui non si
 * conosce la posizione. Solo tiendas pubblicate.
 */
export default async function SearchPage({ searchParams }: PageProps<'/buscar'>) {
  const params = await searchParams;
  const t = await getTranslations('search');
  let latitude: unknown = single(params.lat);
  let longitude: unknown = single(params.lng);
  let city = single(params.ciudad) ?? null;
  let place = single(params.dir) ?? null;

  // Un indirizzo salvato in "Mi cuenta": solo della persona che ha fatto l'accesso.
  const savedId = single(params.direccion);
  if (savedId) {
    const session = await getSession();
    const saved = session
      ? (await listBuyerSearchAddresses({ userId: session.user.id, country: 'MX' })).find(
          (address) => address.id === savedId,
        )
      : undefined;
    if (saved) {
      latitude = saved.coordinates?.latitude;
      longitude = saved.coordinates?.longitude;
      city = saved.city;
      place = saved.label;
    }
  }

  const result = await searchPublicStores({ latitude, longitude, city });
  const where = place ?? city;
  // Con un indirizzo preciso si parla di "tu dirección"; con la sola città, della colonia.
  const byAddress = place !== null;
  const empty = result.nearby.length === 0 && result.sameCity.length === 0;

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.03_12),transparent_60%)]">
      <BuyerHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16">
        <Link
          href={buyerRoutes.home}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('changePlace')}
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
          {place ? t('titleFor', { place }) : city ? t('titleCity', { city }) : t('title')}
        </h1>

        {empty ? (
          <div className="mt-8 rounded-2xl border bg-card p-6 text-center">
            <Search className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-medium">{where ? t('emptyTitle') : t('noPlace')}</p>
            {where ? <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p> : null}
            <Button asChild variant="outline" className="mt-4">
              <Link href={buyerRoutes.home}>{t('tryAnother')}</Link>
            </Button>
          </div>
        ) : null}

        {result.nearby.length > 0 ? (
          <section aria-labelledby="nearby" className="mt-8">
            <h2 id="nearby" className="font-semibold">
              {t('nearbyTitle', { count: result.nearby.length })}
            </h2>
            <StoreList stores={result.nearby} t={t} />
          </section>
        ) : null}

        {result.sameCity.length > 0 ? (
          <section aria-label={t('sameCityTitle', { city: city ?? '' })} className="mt-8">
            {/* Con la sola città il titolo della pagina lo dice già. */}
            {byAddress ? (
              <h2 className="font-semibold">{t('sameCityTitle', { city: city ?? '' })}</h2>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              {byAddress ? t('sameCityBody') : t('sameCityBodyCity')}
            </p>
            <StoreList stores={result.sameCity} t={t} />
          </section>
        ) : null}
      </main>
      <footer className="pb-8">
        <LegalLinks audience="buyer" />
      </footer>
    </div>
  );
}

function StoreList({
  stores,
  t,
}: {
  readonly stores: readonly DirectoryStoreDto[];
  readonly t: Awaited<ReturnType<typeof getTranslations<'search'>>>;
}) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {stores.map((store) => {
        const routes = publicStoreRoutes(store.slug);
        return (
          <li key={store.slug}>
            <Link
              // Passa dalla rotta dell'attribuzione: l'ordine sarà "portato da Gardelia" (D-24).
              href={buyerRoutes.fromSearch(store.slug)}
              prefetch={false}
              className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
                {store.logoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo servito dall'app.
                  <img
                    src={routes.image('LOGO', store.logoId)}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <Flower2 className="size-6 text-primary" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{store.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {[store.neighborhood, store.city].filter(Boolean).join(', ')}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {store.distanceKm !== null
                    ? t('distance', { km: store.distanceKm, count: store.onlineItems })
                    : t('products', { count: store.onlineItems })}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
