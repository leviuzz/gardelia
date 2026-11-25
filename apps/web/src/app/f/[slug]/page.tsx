import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Globe,
  MapPin,
  ScrollText,
  Search,
  ShoppingBag,
  Star,
  Store,
  Truck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getFormatter, getMessages, getTranslations } from 'next-intl/server';
import type { PublicStoreItemDto } from '@floral/core';
import {
  BRAND,
  STOREFRONT_LIMITS,
  STOREFRONT_SORTS,
  WEEKDAYS_FROM_MONDAY,
  storefrontFiltered,
} from '@floral/domain';
import { OpeningHoursList } from '@/components/common/opening-hours-list';
import { CartBar } from '@/components/public/cart-bar';
import { ProductCard } from '@/components/public/product-card';
import { StoreShell } from '@/components/public/store-shell';
import { AddToCartButton } from '@/components/public/storefront-cart';
import { StorefrontSort } from '@/components/public/storefront-sort';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { loadStorefront, storeShellProps, storefrontQueryKey } from '@/lib/public-store';
import { publicStoreRoutes } from '@/lib/routes';
import { storeFacts, storePolicies, type StoreFactKind } from '@/lib/storefront-ui';
import { cn } from '@/lib/utils';

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/f/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const view = await loadStorefront(slug, storefrontQueryKey(await searchParams));
  if (!view) return { title: BRAND.productName };
  const { store } = view;
  // Anteprima nei social e su WhatsApp: la copertina, altrimenti il logo.
  const routes = publicStoreRoutes(store.slug);
  const image = store.coverId
    ? routes.image('COVER', store.coverId)
    : store.logoId
      ? routes.image('LOGO', store.logoId)
      : null;
  return {
    // Il layout aggiunge «· Gardelia» (prima usciva due volte).
    title: store.name,
    description: store.description ?? undefined,
    openGraph: {
      title: store.name,
      description: store.description ?? undefined,
      ...(image ? { images: [`${serverEnv().APP_URL.replace(/\/+$/, '')}${image}`] } : {}),
    },
  };
}

const FACT_ICONS: Record<StoreFactKind, typeof Globe> = {
  orders: Globe,
  firstDay: CalendarDays,
  fee: Truck,
  pickup: Store,
};

/**
 * Pagina pubblica della fioreria (marketplace, blocco C2, ADR-065; vetrina M1, ADR-087): in alto
 * ordini online, primo giorno e costo; poi «Destacados», schede, ricerca, ordine e pagine da 24; in
 * fondo orari, consegne, pagamenti e politiche. Con gli ordini online accesi, «Agregar» mette il
 * prodotto nel carrello (cookie) e la barra «Tu pedido» porta al modulo.
 */
export default async function PublicStorePage({ params, searchParams }: PageProps<'/f/[slug]'>) {
  const { slug } = await params;
  const view = await loadStorefront(slug, storefrontQueryKey(await searchParams));
  if (!view) notFound();
  const { store, query } = view;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'publicStore' });
  const format = await getFormatter({ locale });
  const routes = publicStoreRoutes(store.slug);
  const fmt = (minor: number) => money(minor, store.currency, locale);
  // 22/11/2026 è una domenica (0): nomi dei giorni nella lingua del mercato.
  const dayName = (weekday: number) =>
    format.dateTime(new Date(Date.UTC(2026, 10, 22 + weekday, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
  const closedDays = WEEKDAYS_FROM_MONDAY.filter((day) =>
    store.delivery.closedWeekdays.includes(day),
  ).map(dayName);
  const shell = await storeShellProps(store, t('whatsappHello'));
  const canOrder = store.ordersEnabled && store.delivery.firstDate !== null;
  const facts = storeFacts(store, t, format);
  const policies = storePolicies(store, t);
  const filtered = storefrontFiltered(query);
  const viewHref = (overrides: Partial<typeof query>) =>
    routes.storefront({ ...query, pagina: 1, ...overrides });
  const messages = await getMessages({ locale });

  const card = (item: PublicStoreItemDto, featuredBadge: boolean) => (
    <ProductCard
      href={routes.item(item.id)}
      name={item.name}
      photoSrc={item.photoId ? routes.photo(item.id, item.photoId, { thumb: true }) : null}
      price={
        item.saleUnit === 'PIECE'
          ? fmt(item.priceMinor)
          : t('pricePerUnit', { price: fmt(item.priceMinor), unit: t(`units.${item.saleUnit}`) })
      }
      availability={
        item.availability === 'AVAILABLE' ? null : t(`availability.${item.availability}`)
      }
      soldOut={item.availability === 'OUT_OF_STOCK'}
      featuredLabel={featuredBadge && item.featured ? t('featuredBadge') : null}
      action={
        canOrder && item.availability !== 'OUT_OF_STOCK' ? (
          <AddToCartButton slug={store.slug} itemId={item.id} name={item.name} />
        ) : null
      }
    />
  );

  return (
    <StoreShell {...shell}>
      <NextIntlClientProvider locale={locale} messages={{ publicStore: messages.publicStore }}>
        {store.coverId ? (
          <div className="mb-6 aspect-[2/1] overflow-hidden rounded-2xl border bg-muted sm:aspect-[3/1]">
            {/* eslint-disable-next-line @next/next/no-img-element -- copertina servita dall'app. */}
            <img
              src={routes.image('COVER', store.coverId)}
              alt={t('coverAlt', { name: store.name })}
              className="size-full object-cover"
            />
          </div>
        ) : null}
        <section className="max-w-2xl">
          <div className="flex items-center gap-4">
            {store.logoId ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo servito dall'app.
              <img
                src={routes.image('LOGO', store.logoId)}
                alt={t('logoAlt', { name: store.name })}
                className="size-16 shrink-0 rounded-2xl border bg-white object-contain sm:size-20"
              />
            ) : null}
            <h1 className="font-display text-3xl font-semibold tracking-tight break-words sm:text-4xl">
              {store.name}
            </h1>
          </div>
          {store.address ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {[store.address.neighborhood, store.address.city].filter(Boolean).join(', ')}
            </p>
          ) : null}
          <ul className="mt-4 flex flex-wrap gap-2" data-testid="store-facts">
            {facts.map((fact) => {
              const Icon = FACT_ICONS[fact.kind];
              return (
                <li
                  key={fact.kind}
                  className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm"
                >
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {fact.label}
                </li>
              );
            })}
          </ul>
          {store.description ? (
            <p className="mt-4 leading-relaxed whitespace-pre-line">{store.description}</p>
          ) : null}
          {canOrder && view.onlineCount > 0 ? (
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <Button asChild size="lg">
                <Link href={routes.checkout()}>
                  <ShoppingBag />
                  {t('orderCta')}
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">{t('orderHow')}</p>
            </div>
          ) : null}
        </section>

        {view.featured.length > 0 ? (
          <section aria-labelledby="featured" className="mt-10">
            <h2
              id="featured"
              className="flex items-center gap-2 font-display text-xl font-semibold"
            >
              <Star className="size-5 text-primary" aria-hidden="true" />
              {t('featuredTitle')}
            </h2>
            <ul
              className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
              data-testid="featured-items"
            >
              {view.featured.map((item) => (
                <li key={item.id}>{card(item, false)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="products" className="mt-10" data-testid="storefront">
          <h2 id="products" className="font-display text-xl font-semibold">
            {t('productsTitle')}
          </h2>
          {view.onlineCount === 0 ? (
            <p className="mt-4 text-muted-foreground">{t('noProducts')}</p>
          ) : (
            <>
              {view.categories.length > 1 ? (
                <nav aria-label={t('categoriesLabel')} className="-mx-1 mt-4 overflow-x-auto">
                  <ul className="flex gap-2 px-1 pb-1">
                    {[
                      { key: undefined, label: t('tabAll'), count: view.onlineCount },
                      ...view.categories.map((entry) => ({
                        key: entry.category,
                        label: t(`categories.${entry.category}`),
                        count: entry.count,
                      })),
                    ].map((tab) => {
                      const active = query.categoria === tab.key;
                      return (
                        <li key={tab.key ?? 'all'} className="shrink-0">
                          <Link
                            href={viewHref({ categoria: tab.key })}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'bg-card hover:bg-muted',
                            )}
                          >
                            {tab.label}
                            <span className="tabular-nums opacity-70">{tab.count}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ) : null}
              <form
                action={routes.home}
                method="get"
                role="search"
                className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                {query.categoria ? (
                  <input type="hidden" name="categoria" value={query.categoria} />
                ) : null}
                <div className="flex min-w-0 flex-1 gap-2">
                  <Input
                    type="search"
                    name="q"
                    defaultValue={query.q ?? ''}
                    maxLength={STOREFRONT_LIMITS.query}
                    placeholder={t('searchPlaceholder')}
                    aria-label={t('searchLabel')}
                    className="min-w-0 flex-1"
                  />
                  <Button type="submit" variant="outline" className="shrink-0">
                    <Search />
                    <span className="sr-only sm:not-sr-only">{t('searchButton')}</span>
                  </Button>
                </div>
                <div className="sm:w-56">
                  <StorefrontSort
                    id="storefront-sort"
                    label={t('sortLabel')}
                    value={query.orden}
                    options={STOREFRONT_SORTS.map((sort) => ({
                      value: sort,
                      label: t(`sorts.${sort}`),
                    }))}
                  />
                </div>
              </form>
              <p className="mt-4 text-sm text-muted-foreground" data-testid="results-count">
                {query.q
                  ? t('resultsFor', { count: view.total, q: query.q })
                  : t('resultsCount', { count: view.total })}
                {filtered ? (
                  <>
                    {' · '}
                    <Link href={routes.home} className="underline underline-offset-4">
                      {t('backToStore')}
                    </Link>
                  </>
                ) : null}
              </p>
              {view.items.length === 0 ? (
                <p className="mt-6 text-muted-foreground">{t('noResults')}</p>
              ) : (
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                  {view.items.map((item) => (
                    <li key={item.id}>{card(item, true)}</li>
                  ))}
                </ul>
              )}
              {view.pageCount > 1 ? (
                <nav
                  aria-label={t('pagination')}
                  className="mt-6 flex items-center justify-between gap-2"
                >
                  {view.page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={viewHref({ pagina: view.page - 1 })} rel="prev">
                        <ChevronLeft />
                        {t('previous')}
                      </Link>
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t('pageOf', { page: view.page, pages: view.pageCount })}
                  </span>
                  {view.page < view.pageCount ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={viewHref({ pagina: view.page + 1 })} rel="next">
                        {t('next')}
                        <ChevronRight />
                      </Link>
                    </Button>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          {store.openingHours ? (
            <div className="rounded-2xl border bg-card p-5" data-testid="store-hours">
              <h2 className="flex items-center gap-2 font-semibold">
                <Clock className="size-4 text-primary" aria-hidden="true" />
                {t('hoursTitle')}
              </h2>
              <OpeningHoursList
                className="mt-3"
                days={store.openingHours}
                dayName={dayName}
                dayRange={(first, last) => t('hoursDays', { first, last })}
                closedLabel={t('hoursClosed')}
              />
            </div>
          ) : null}
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Truck className="size-4 text-primary" aria-hidden="true" />
              {t('deliveryTitle')}
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {store.delivery.windows.length > 0 ? (
                <li className="flex gap-2">
                  <Clock
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    {t('windows', {
                      windows: store.delivery.windows
                        .map((window) => t('window', { start: window.start, end: window.end }))
                        .join(', '),
                    })}
                  </span>
                </li>
              ) : null}
              {closedDays.length > 0 ? (
                <li>{t('closedDays', { days: closedDays.join(', ') })}</li>
              ) : null}
              {store.delivery.feeTiers.length > 0 ? (
                <li>
                  {t('feeByDistance', {
                    tiers: store.delivery.feeTiers
                      .map((tier) => t('feeTier', { km: tier.maxKm, fee: fmt(tier.feeMinor) }))
                      .join(' · '),
                  })}
                </li>
              ) : store.delivery.defaultFeeMinor > 0 ? (
                <li>{t('deliveryFee', { fee: fmt(store.delivery.defaultFeeMinor) })}</li>
              ) : null}
              {store.delivery.radiusKm ? (
                <li>{t('radius', { km: store.delivery.radiusKm })}</li>
              ) : null}
              {store.address ? (
                <li className="flex gap-2">
                  <MapPin
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    {t('pickup', {
                      address: [
                        store.address.line,
                        store.address.neighborhood,
                        store.address.city,
                        store.address.region,
                      ]
                        .filter(Boolean)
                        .join(', '),
                    })}
                  </span>
                </li>
              ) : null}
              {store.ordersEnabled ? null : (
                <li className="text-muted-foreground">{t('deliveryAsk')}</li>
              )}
            </ul>
          </div>
          {store.paymentMethods.length > 0 || store.paymentInstructions ? (
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <CreditCard className="size-4 text-primary" aria-hidden="true" />
                {t('paymentTitle')}
              </h2>
              {store.paymentMethods.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {store.paymentMethods.map((method) => (
                    <li key={method}>
                      <Badge variant="secondary">{t(`payment.${method}`)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              {store.paymentInstructions ? (
                <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">
                  {store.paymentInstructions}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">{t('paymentDirect')}</p>
            </div>
          ) : null}
        </section>

        {policies.length > 0 ? (
          <section
            aria-labelledby="policies"
            className="mt-4 rounded-2xl border bg-card p-5"
            data-testid="store-policies"
          >
            <h2 id="policies" className="flex items-center gap-2 font-semibold">
              <ScrollText className="size-4 text-primary" aria-hidden="true" />
              {t('policiesTitle')}
            </h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              {policies.map((policy) => (
                <div key={policy.title}>
                  <dt className="font-medium">{policy.title}</dt>
                  <dd className="mt-1 whitespace-pre-line text-muted-foreground">{policy.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {t('policiesByShop', { shop: store.name })}
            </p>
          </section>
        ) : null}

        {canOrder && view.cart ? (
          <CartBar
            href={routes.checkout()}
            label={t('cartBar', {
              units: view.cart.units,
              total: fmt(view.cart.subtotalMinor),
            })}
            continueLabel={t('cartContinue')}
          />
        ) : null}
      </NextIntlClientProvider>
    </StoreShell>
  );
}
