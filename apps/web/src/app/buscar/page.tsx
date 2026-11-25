import { ArrowLeft, Flower2, Gift, MapPin, Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import {
  listBuyerSearchAddresses,
  listPublicStoreCities,
  searchPublicStores,
  type DirectoryStoreDto,
} from '@floral/core';
import { CATALOG_OCCASIONS, OCCASION_SLUGS, occasionFromSlug } from '@floral/domain';
import { LegalLinks } from '@/components/legal/legal-links';
import { BuyerHeader } from '@/components/public/buyer-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { buyerRoutes, publicStoreRoutes, type QueryValues } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { feeSummaryLabel, firstDayLabel } from '@/lib/storefront-ui';

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
 * conosce la posizione. Solo tiendas pubblicate. Le schede dicono se si ordina online, il primo
 * giorno e il costo (M1-2); un'occasione filtra le fiorerie e apre la vetrina già filtrata.
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

  // Occasione (M1-2): un valore sconosciuto si ignora.
  const occasion = occasionFromSlug(single(params.ocasion));
  const occasionSlug = occasion ? OCCASION_SLUGS[occasion] : undefined;
  const result = await searchPublicStores({ latitude, longitude, city, occasion: occasionSlug });
  const where = place ?? city;
  // Con un indirizzo preciso si parla di "tu dirección"; con la sola città, della colonia.
  const byAddress = place !== null;
  const empty = result.nearby.length === 0 && result.sameCity.length === 0;
  // La stessa ricerca con un'altra occasione (o nessuna).
  const current: QueryValues = {
    lat: single(params.lat),
    lng: single(params.lng),
    dir: single(params.dir),
    ciudad: single(params.ciudad),
    direccion: savedId,
  };
  const withOccasion = (slug: string | undefined) =>
    buyerRoutes.search({ ...current, ocasion: slug });
  // Arrivati da una scorciatoia della home senza un posto: si sceglie la città.
  const occasionCities = occasion && !where ? await listPublicStoreCities(occasionSlug) : [];
  const found = [...result.nearby, ...result.sameCity];
  const occasionsHere = CATALOG_OCCASIONS.filter((entry) =>
    found.some((store) => store.occasions.includes(entry)),
  );
  const tOccasion = await getTranslations('occasions');
  const tStore = await getTranslations('publicStore');
  const format = await getFormatter();
  const locale = await getLocale();
  const facts = (store: DirectoryStoreDto) => {
    const fmt = (minor: number) => money(minor, store.currency, locale);
    return {
      orders: store.ordersOnline ? t('ordersOnline') : t('whatsappOnly'),
      firstDay: store.ordersOnline ? firstDayLabel(store, tStore, format) : null,
      fee:
        store.fee.exact && store.fee.summary.kind === 'fixed'
          ? t('feeToAddress', { fee: fmt(store.fee.summary.feeMinor) })
          : feeSummaryLabel(store.fee.summary, fmt, tStore),
    };
  };

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

        {/* Occasione scelta: si toglie con la «x»; senza, quelle delle fiorerie trovate. */}
        {occasion ? (
          <p className="mt-3">
            <Link
              href={withOccasion(undefined)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm text-primary"
              aria-label={t('clearOccasion', { occasion: tOccasion(occasion) })}
            >
              <Gift className="size-3.5" aria-hidden="true" />
              {t('occasionTitle', { occasion: tOccasion(occasion) })}
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
        ) : occasionsHere.length > 0 ? (
          <nav aria-label={t('occasionsLabel')} className="-mx-1 mt-3 overflow-x-auto">
            <ul className="flex gap-2 px-1 pb-1">
              {occasionsHere.map((entry) => (
                <li key={entry} className="shrink-0">
                  <Link
                    href={withOccasion(OCCASION_SLUGS[entry])}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:bg-muted"
                  >
                    <Gift className="size-3.5" aria-hidden="true" />
                    {tOccasion(entry)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {occasion && !where ? (
          <section aria-labelledby="occasion-cities" className="mt-8" data-testid="occasion-cities">
            <h2 id="occasion-cities" className="font-semibold">
              {occasionCities.length > 0 ? t('chooseCity') : t('noOccasionStores')}
            </h2>
            {occasionCities.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {occasionCities.map((entry) => (
                  <li key={entry}>
                    <Button asChild variant="outline" size="sm">
                      <Link href={buyerRoutes.search({ ciudad: entry, ocasion: occasionSlug })}>
                        <MapPin />
                        {entry}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : empty ? (
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
            <StoreList stores={result.nearby} t={t} facts={facts} occasion={occasionSlug} />
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
            <StoreList stores={result.sameCity} t={t} facts={facts} occasion={occasionSlug} />
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
  facts,
  occasion,
}: {
  readonly stores: readonly DirectoryStoreDto[];
  readonly t: Awaited<ReturnType<typeof getTranslations<'search'>>>;
  readonly facts: (store: DirectoryStoreDto) => {
    readonly orders: string;
    readonly firstDay: string | null;
    readonly fee: string;
  };
  /** L'occasione scelta: la vetrina si apre già filtrata. */
  readonly occasion: string | undefined;
}) {
  return (
    <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {stores.map((store) => {
        const routes = publicStoreRoutes(store.slug);
        const card = facts(store);
        return (
          <li key={store.slug}>
            <Link
              // Passa dalla rotta dell'attribuzione: l'ordine sarà "portato da Gardelia" (D-24).
              href={buyerRoutes.fromSearch(store.slug, { ocasion: occasion })}
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
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {[store.neighborhood, store.city].filter(Boolean).join(', ')}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {store.distanceKm !== null
                    ? t('distance', { km: store.distanceKm, count: store.onlineItems })
                    : t('products', { count: store.onlineItems })}
                </span>
                {/* Schede (M1-2): si ordina online o su WhatsApp, primo giorno, costo. */}
                <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge
                    variant={store.ordersOnline ? 'success' : 'secondary'}
                    className="shrink-0"
                  >
                    {card.orders}
                  </Badge>
                  {card.firstDay ? <span>{card.firstDay}</span> : null}
                  <span className="text-muted-foreground">{card.fee}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
