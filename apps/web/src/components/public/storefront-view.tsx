import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Flower2,
  Gift,
  Globe,
  MapPin,
  MessageCircle,
  Plus,
  ScrollText,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { NextIntlClientProvider } from 'next-intl';
import { getFormatter, getMessages, getTranslations } from 'next-intl/server';
import type {
  PublicStoreItemDetailDto,
  PublicStoreItemDto,
  PublicStorefrontDto,
} from '@floral/core';
import {
  OCCASION_SLUGS,
  STOREFRONT_LIMITS,
  STOREFRONT_SORTS,
  WEEKDAYS_FROM_MONDAY,
  isCatalogColor,
  storefrontFiltered,
  whatsappLink,
} from '@floral/domain';
import { AssistantSpeciesFacts } from '@/components/care/assistant-answer';
import { OpeningHoursList } from '@/components/common/opening-hours-list';
import { CartBar } from '@/components/public/cart-bar';
import { ProductCard } from '@/components/public/product-card';
import { ProductGallery } from '@/components/public/product-gallery';
import { ProductOrderBox } from '@/components/public/product-order-box';
import { StoreShell } from '@/components/public/store-shell';
import { AddToCartButton } from '@/components/public/storefront-cart';
import { StorefrontSort } from '@/components/public/storefront-sort';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { absoluteUrl } from '@/lib/indexing';
import { storeShellProps } from '@/lib/public-store';
import { accountRoutes, withQuery, type StoreLinks } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { firstDayLabel, storeFacts, storePolicies, type StoreFactKind } from '@/lib/storefront-ui';
import {
  productStructuredData,
  serializeStructuredData,
  storeStructuredData,
} from '@/lib/structured-data';
import { cn } from '@/lib/utils';

/**
 * «Mis pedidos» per chi ha il conto, «Entrar» per gli altri (M1-2): dopo l'accesso si torna alla
 * pagina. Niente nell'anteprima della fioreria.
 */
async function accountLink(
  preview: boolean,
  back: string,
  labels: { orders: string; signIn: string },
) {
  if (preview) return null;
  return (await getSession())
    ? { href: accountRoutes.home, label: labels.orders }
    : { href: withQuery('/login', { next: back }), label: labels.signIn };
}

const FACT_ICONS: Record<StoreFactKind, typeof Globe> = {
  orders: Globe,
  firstDay: CalendarDays,
  fee: Truck,
  pickup: Store,
};

/**
 * La vetrina della fioreria (marketplace, blocco C2, ADR-065; M1, ADR-087): in alto ordini online,
 * primo giorno e costo; poi «Destacados», schede, ricerca, ordine e pagine da 24; in fondo orari,
 * consegne, pagamenti e politiche. Con gli ordini online accesi, «Agregar» mette il prodotto nel
 * carrello (cookie) e la barra «Tu pedido» porta al modulo.
 *
 * La stessa vista serve all'anteprima della fioreria (M1-2): link dell'app, foto dalle pagine
 * private e pulsanti d'ordine spenti (`preview`).
 */
export async function StorefrontView({
  view,
  links,
  preview = false,
}: {
  readonly view: PublicStorefrontDto;
  readonly links: StoreLinks;
  readonly preview?: boolean;
}) {
  const { store, query } = view;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'publicStore' });
  const tOccasion = await getTranslations({ locale, namespace: 'occasions' });
  const tRoot = await getTranslations({ locale });
  const format = await getFormatter({ locale });
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
  const shell = await storeShellProps(store, t('whatsappHello'), links);
  const account = await accountLink(preview, links.home, {
    orders: t('accountOrders'),
    signIn: t('accountSignIn'),
  });
  const canOrder = store.ordersEnabled && store.delivery.firstDate !== null;
  const facts = storeFacts(store, t, format);
  const policies = storePolicies(store, t);
  const filtered = storefrontFiltered(query);
  const viewHref = (overrides: Partial<typeof query>) =>
    links.storefront({ ...query, pagina: 1, ...overrides });
  const messages = await getMessages({ locale });

  const addButton = (item: PublicStoreItemDto) =>
    preview ? (
      <Button type="button" size="sm" variant="outline" className="w-full" disabled>
        <Plus />
        {t('add')}
      </Button>
    ) : (
      <AddToCartButton slug={store.slug} itemId={item.id} name={item.name} />
    );

  const card = (item: PublicStoreItemDto, featuredBadge: boolean) => (
    <ProductCard
      href={links.item(item.id)}
      name={item.name}
      photoSrc={item.photoId ? links.photo(item.id, item.photoId, { thumb: true }) : null}
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
      action={canOrder && item.availability !== 'OUT_OF_STOCK' ? addButton(item) : null}
    />
  );

  return (
    <StoreShell {...shell} account={account}>
      <NextIntlClientProvider locale={locale} messages={{ publicStore: messages.publicStore }}>
        {store.coverId ? (
          <div className="mb-6 aspect-[2/1] overflow-hidden rounded-2xl border bg-muted sm:aspect-[3/1]">
            {/* eslint-disable-next-line @next/next/no-img-element -- copertina servita dall'app. */}
            <img
              src={links.image('COVER', store.coverId)}
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
                src={links.image('LOGO', store.logoId)}
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
              {preview ? (
                <Button size="lg" disabled>
                  <ShoppingBag />
                  {t('orderCta')}
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href={links.checkout()}>
                    <ShoppingBag />
                    {t('orderCta')}
                  </Link>
                </Button>
              )}
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

        {/* M5: i servizi della fioreria (eventi, decorazioni, Floral Care…), solo quelli pubblicati. */}
        {view.services.length > 0 && !filtered ? (
          <section aria-labelledby="services" className="mt-10" data-testid="storefront-services">
            <h2
              id="services"
              className="flex items-center gap-2 font-display text-xl font-semibold"
            >
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              {t('servicesTitle')}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {view.services.map((service) => {
                const name = service.name ?? tRoot(`serviceNames.${service.kind}`);
                return (
                  <li key={service.id}>
                    <Link
                      href={links.service(service.id)}
                      className="group flex h-full gap-3 rounded-2xl border bg-card p-3 transition-colors hover:border-primary/50"
                      data-testid={`storefront-service-${service.kind}`}
                    >
                      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                        {service.photoId ? (
                          // eslint-disable-next-line @next/next/no-img-element -- foto servita dalla rotta della vetrina
                          <img
                            src={links.servicePhoto(service.id, service.photoId, { thumb: true })}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <Flower2 className="size-7 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium break-words group-hover:text-primary">{name}</p>
                        {service.description ? (
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {service.description}
                          </p>
                        ) : null}
                        <p className="text-sm">
                          {service.priceFromMinor !== null ? (
                            <span className="font-semibold tabular-nums">
                              {t('servicePriceFrom', { price: fmt(service.priceFromMinor) })}
                            </span>
                          ) : null}
                          <span className="ml-2 text-primary">{t('serviceRequest')}</span>
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
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
              {/* Occasioni (M1-2): solo quelle con prodotti; toccata di nuovo si toglie. */}
              {view.occasions.length > 0 ? (
                <nav
                  aria-label={t('occasionsLabel')}
                  className="-mx-1 mt-3 overflow-x-auto"
                  data-testid="storefront-occasions"
                >
                  <ul className="flex gap-2 px-1 pb-1">
                    {view.occasions.map(({ occasion, count }) => {
                      const slug = OCCASION_SLUGS[occasion];
                      const active = query.ocasion === slug;
                      return (
                        <li key={occasion} className="shrink-0">
                          <Link
                            href={viewHref({ ocasion: active ? undefined : slug })}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                              active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'bg-card hover:bg-muted',
                            )}
                          >
                            <Gift className="size-3.5" aria-hidden="true" />
                            {tOccasion(occasion)}
                            <span className="tabular-nums opacity-70">{count}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ) : null}
              <form
                action={links.home}
                method="get"
                role="search"
                className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                {query.categoria ? (
                  <input type="hidden" name="categoria" value={query.categoria} />
                ) : null}
                {query.ocasion ? (
                  <input type="hidden" name="ocasion" value={query.ocasion} />
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
                    <Link href={links.home} className="underline underline-offset-4">
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
          {store.paymentMethods.length > 0 ? (
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
              {/* I dati per pagare (CLABE, conto) arrivano solo a ordine accettato (M3-3). */}
              <p className="mt-3 text-sm text-muted-foreground" data-testid="store-payment-later">
                {t(store.ordersEnabled ? 'paymentAfterAccept' : 'paymentAsk')}
              </p>
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

        {canOrder && view.cart && !preview ? (
          <CartBar
            href={links.checkout()}
            label={t('cartBar', {
              units: view.cart.units,
              total: fmt(view.cart.subtotalMinor),
            })}
            continueLabel={t('cartContinue')}
          />
        ) : null}
        {/* Dati strutturati per Google (M1-2): solo nella pagina pubblica. */}
        {preview ? null : (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: serializeStructuredData(
                storeStructuredData(store, {
                  url: absoluteUrl(serverEnv().APP_URL, links.home),
                  imageUrl: store.coverId
                    ? absoluteUrl(serverEnv().APP_URL, links.image('COVER', store.coverId))
                    : store.logoId
                      ? absoluteUrl(serverEnv().APP_URL, links.image('LOGO', store.logoId))
                      : null,
                }),
              ),
            }}
          />
        )}
      </NextIntlClientProvider>
    </StoreShell>
  );
}

/**
 * Un prodotto della vetrina (ADR-065; M1, ADR-087): galleria con le foto a schermo intero, prezzo,
 * di cosa è fatto, per le piante la cura dai nostri dati (ADR-085), e con gli ordini online
 * quantità, «Agregar al pedido» e «Pedir ahora». WhatsApp resta come alternativa. Nell'anteprima
 * della fioreria (M1-2) i pulsanti d'ordine sono spenti.
 */
export async function ProductView({
  detail,
  links,
  preview = false,
}: {
  readonly detail: PublicStoreItemDetailDto;
  readonly links: StoreLinks;
  readonly preview?: boolean;
}) {
  const { store, item, cart } = detail;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'publicStore' });
  const tCatalog = await getTranslations({ locale, namespace: 'catalog' });
  const tRoot = await getTranslations({ locale });
  const format = await getFormatter({ locale });
  const fmt = (minor: number) => money(minor, store.currency, locale);
  const price =
    item.saleUnit === 'PIECE'
      ? fmt(item.priceMinor)
      : t('pricePerUnit', { price: fmt(item.priceMinor), unit: t(`units.${item.saleUnit}`) });
  const url = `${serverEnv().APP_URL.replace(/\/+$/, '')}${links.item(item.id)}`;
  const orderText = t('whatsappItem', { name: item.name, price, url });
  const shell = await storeShellProps(store, t('whatsappHello'), links);
  const account = await accountLink(preview, links.item(item.id), {
    orders: t('accountOrders'),
    signIn: t('accountSignIn'),
  });
  const colors = item.colors.filter(isCatalogColor);
  const size = [item.heightCm, item.widthCm].every((value) => value !== null)
    ? t('size', { height: item.heightCm ?? 0, width: item.widthCm ?? 0 })
    : item.heightCm !== null
      ? t('height', { height: item.heightCm })
      : null;
  const soldOut = item.availability === 'OUT_OF_STOCK';
  const canOrder = store.ordersEnabled && store.delivery.firstDate !== null && !soldOut;
  const firstDay = canOrder ? firstDayLabel(store.delivery, t, format) : null;
  const messages = await getMessages({ locale });

  return (
    <StoreShell {...shell} account={account}>
      <NextIntlClientProvider locale={locale} messages={{ publicStore: messages.publicStore }}>
        <Link
          href={links.home}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('backToStore')}
        </Link>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <ProductGallery
            name={item.name}
            photos={item.photoIds.map((photoId) => ({
              id: photoId,
              src: links.photo(item.id, photoId),
              thumbSrc: links.photo(item.id, photoId, { thumb: true }),
            }))}
          />

          <div className="min-w-0 space-y-5">
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight break-words">
                {item.name}
              </h1>
              <p className="mt-2 text-xl font-semibold tabular-nums">{price}</p>
              {item.availability !== 'AVAILABLE' ? (
                <Badge className="mt-2" variant={soldOut ? 'muted' : 'warning'}>
                  {t(`availability.${item.availability}`)}
                </Badge>
              ) : null}
              {firstDay ? (
                <p
                  className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
                  data-testid="item-first-day"
                >
                  <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {firstDay}
                </p>
              ) : null}
            </div>

            {item.description ? (
              <p className="leading-relaxed whitespace-pre-line">{item.description}</p>
            ) : null}

            {canOrder ? (
              <ProductOrderBox
                slug={store.slug}
                itemId={item.id}
                name={item.name}
                checkoutHref={links.checkout()}
                disabled={preview}
              />
            ) : null}

            {item.includes.length > 0 ? (
              <div>
                <h2 className="text-sm font-semibold">{t('includes')}</h2>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {item.includes.map((line, index) => (
                    <li key={`${line.name}-${index}`}>
                      {t('includesLine', { quantity: line.quantity, name: line.name })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {colors.length > 0 || size ? (
              <dl className="grid gap-2 text-sm">
                {colors.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">{t('colors')}</dt>
                    <dd>{colors.map((color) => tCatalog(`colors.${color}`)).join(', ')}</dd>
                  </div>
                ) : null}
                {size ? (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">{t('sizeLabel')}</dt>
                    <dd>{size}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {/* Piante: luce, acqua e cani e gatti SOLO dai nostri dati, con la fonte (ADR-085). */}
            {item.species ? (
              <div data-testid="item-plant-care">
                <AssistantSpeciesFacts species={item.species} t={tRoot} />
              </div>
            ) : null}

            {store.phone && !soldOut ? (
              <div className="space-y-2">
                {preview ? (
                  <Button
                    size="lg"
                    variant={canOrder ? 'outline' : 'default'}
                    className="w-full sm:w-auto"
                    disabled
                  >
                    <MessageCircle />
                    {t('orderWhatsapp')}
                  </Button>
                ) : (
                  <Button
                    asChild
                    size="lg"
                    variant={canOrder ? 'outline' : 'default'}
                    className="w-full sm:w-auto"
                  >
                    <a
                      href={whatsappLink(store.phone, orderText)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle />
                      {t('orderWhatsapp')}
                    </a>
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">{t('orderWhatsappHint')}</p>
              </div>
            ) : null}

            {store.paymentMethods.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('paysWith', {
                  methods: store.paymentMethods.map((method) => t(`payment.${method}`)).join(', '),
                })}
              </p>
            ) : null}
          </div>
        </div>

        {store.ordersEnabled && store.delivery.firstDate !== null && cart && !preview ? (
          <CartBar
            href={links.checkout()}
            label={t('cartBar', { units: cart.units, total: fmt(cart.subtotalMinor) })}
            continueLabel={t('cartContinue')}
          />
        ) : null}
        {/* Dati strutturati per Google (M1-2): solo nella pagina pubblica. */}
        {preview ? null : (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: serializeStructuredData(
                productStructuredData(item, store, {
                  url,
                  imageUrls: item.photoIds.map((photoId) =>
                    absoluteUrl(serverEnv().APP_URL, links.photo(item.id, photoId)),
                  ),
                }),
              ),
            }}
          />
        )}
      </NextIntlClientProvider>
    </StoreShell>
  );
}
