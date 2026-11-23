import { Clock, CreditCard, Flower2, MapPin, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getPublicStore } from '@floral/core';
import { BRAND, WEEKDAYS_FROM_MONDAY } from '@floral/domain';
import { StoreShell } from '@/components/public/store-shell';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/format';
import { storeShellProps } from '@/lib/public-store';
import { publicStoreRoutes } from '@/lib/routes';

export async function generateMetadata({ params }: PageProps<'/f/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) return { title: BRAND.productName };
  return {
    title: `${store.name} · ${BRAND.productName}`,
    description: store.description ?? undefined,
  };
}

/**
 * Pagina pubblica della fioreria (marketplace, blocco C2, ADR-065): chi compra vede i prodotti
 * visibili, come consegna e come si paga, e scrive alla fioreria. Gli ordini online arrivano con
 * C4: fino ad allora nessun pulsante che li prometta.
 */
export default async function PublicStorePage({ params }: PageProps<'/f/[slug]'>) {
  const { slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) notFound();
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

  return (
    <StoreShell {...shell}>
      <section className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {store.name}
        </h1>
        {store.address ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            {[store.address.neighborhood, store.address.city].filter(Boolean).join(', ')}
          </p>
        ) : null}
        {store.description ? (
          <p className="mt-4 leading-relaxed whitespace-pre-line">{store.description}</p>
        ) : null}
      </section>

      <section aria-labelledby="products" className="mt-10">
        <h2 id="products" className="font-display text-xl font-semibold">
          {t('productsTitle')}
        </h2>
        {store.items.length === 0 ? (
          <p className="mt-4 text-muted-foreground">{t('noProducts')}</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {store.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={routes.item(item.id)}
                  className="group block overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
                    {item.photoId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app, già ridotte.
                      <img
                        src={routes.photo(item.id, item.photoId, { thumb: true })}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                      />
                    ) : (
                      <Flower2 className="size-10 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                    <p className="text-sm tabular-nums">
                      {item.saleUnit === 'PIECE'
                        ? fmt(item.priceMinor)
                        : t('pricePerUnit', {
                            price: fmt(item.priceMinor),
                            unit: t(`units.${item.saleUnit}`),
                          })}
                    </p>
                    {item.availability !== 'AVAILABLE' ? (
                      <Badge variant={item.availability === 'OUT_OF_STOCK' ? 'muted' : 'warning'}>
                        {t(`availability.${item.availability}`)}
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
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
            {store.delivery.defaultFeeMinor > 0 ? (
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
            <li className="text-muted-foreground">{t('deliveryAsk')}</li>
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
    </StoreShell>
  );
}
