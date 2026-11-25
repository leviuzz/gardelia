import { ArrowLeft, CalendarDays, Flower2, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getFormatter, getMessages, getTranslations } from 'next-intl/server';
import { BRAND, isCatalogColor, whatsappLink } from '@floral/domain';
import { AssistantSpeciesFacts } from '@/components/care/assistant-answer';
import { CartBar } from '@/components/public/cart-bar';
import { ProductGallery } from '@/components/public/product-gallery';
import { ProductOrderBox } from '@/components/public/product-order-box';
import { StoreShell } from '@/components/public/store-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { loadPublicStore, loadStoreItem, storeShellProps } from '@/lib/public-store';
import { publicStoreRoutes } from '@/lib/routes';
import { firstDayLabel } from '@/lib/storefront-ui';

export async function generateMetadata({
  params,
}: PageProps<'/f/[slug]/p/[itemId]'>): Promise<Metadata> {
  const { slug, itemId } = await params;
  const detail = await loadStoreItem(slug, itemId);
  if (!detail) return { title: BRAND.productName };
  const { store, item } = detail;
  const routes = publicStoreRoutes(store.slug);
  // Anteprima su WhatsApp con la foto del prodotto: la miniatura, leggera.
  const image = item.photoId
    ? `${serverEnv().APP_URL.replace(/\/+$/, '')}${routes.photo(item.id, item.photoId, { thumb: true })}`
    : null;
  return {
    title: `${item.name} · ${store.name}`,
    description: item.description ?? undefined,
    openGraph: {
      title: `${item.name} · ${store.name}`,
      description: item.description ?? undefined,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * Un prodotto della pagina pubblica (ADR-065; M1, ADR-087): galleria con le foto a schermo intero,
 * prezzo, di cosa è fatto, per le piante la cura dai nostri dati (ADR-085), e con gli ordini
 * online quantità, «Agregar al pedido» e «Pedir ahora». WhatsApp resta come alternativa.
 */
export default async function PublicStoreItemPage({ params }: PageProps<'/f/[slug]/p/[itemId]'>) {
  const { slug, itemId } = await params;
  const detail = await loadStoreItem(slug, itemId);
  if (!detail) return <ItemGone slug={slug} />;
  const { store, item, cart } = detail;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'publicStore' });
  const tCatalog = await getTranslations({ locale, namespace: 'catalog' });
  const tRoot = await getTranslations({ locale });
  const format = await getFormatter({ locale });
  const routes = publicStoreRoutes(store.slug);
  const fmt = (minor: number) => money(minor, store.currency, locale);
  const price =
    item.saleUnit === 'PIECE'
      ? fmt(item.priceMinor)
      : t('pricePerUnit', { price: fmt(item.priceMinor), unit: t(`units.${item.saleUnit}`) });
  const url = `${serverEnv().APP_URL.replace(/\/+$/, '')}${routes.item(item.id)}`;
  const orderText = t('whatsappItem', { name: item.name, price, url });
  const shell = await storeShellProps(store, t('whatsappHello'));
  const colors = item.colors.filter(isCatalogColor);
  const size = [item.heightCm, item.widthCm].every((value) => value !== null)
    ? t('size', { height: item.heightCm ?? 0, width: item.widthCm ?? 0 })
    : item.heightCm !== null
      ? t('height', { height: item.heightCm })
      : null;
  const soldOut = item.availability === 'OUT_OF_STOCK';
  const canOrder = store.ordersEnabled && store.delivery.firstDate !== null && !soldOut;
  const firstDay = canOrder ? firstDayLabel(store, t, format) : null;
  const messages = await getMessages({ locale });

  return (
    <StoreShell {...shell}>
      <NextIntlClientProvider locale={locale} messages={{ publicStore: messages.publicStore }}>
        <Link
          href={routes.home}
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
              src: routes.photo(item.id, photoId),
              thumbSrc: routes.photo(item.id, photoId, { thumb: true }),
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
                checkoutHref={routes.checkout()}
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

        {store.ordersEnabled && store.delivery.firstDate !== null && cart ? (
          <CartBar
            href={routes.checkout()}
            label={t('cartBar', { units: cart.units, total: fmt(cart.subtotalMinor) })}
            continueLabel={t('cartContinue')}
          />
        ) : null}
      </NextIntlClientProvider>
    </StoreShell>
  );
}

/**
 * Prodotto tolto dalla vetrina (o mai esistito) in una tienda che c'è ancora: lo si dice e si torna
 * ai prodotti (M0). Se la tienda non c'è, la pagina «Esta tienda no está disponible».
 */
async function ItemGone({ slug }: { readonly slug: string }) {
  const store = await loadPublicStore(slug);
  if (!store) notFound();
  const t = await getTranslations({ locale: store.locale, namespace: 'publicStore' });
  const shell = await storeShellProps(store, t('whatsappHello'));
  return (
    <StoreShell {...shell}>
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center"
        data-testid="item-gone"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Flower2 className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display text-2xl font-semibold">{t('itemGoneTitle')}</h1>
        <p className="text-muted-foreground">{t('itemGoneBody')}</p>
        <Button asChild>
          <Link href={publicStoreRoutes(store.slug).home}>
            <ArrowLeft aria-hidden="true" />
            {t('itemGoneBack', { shop: store.name })}
          </Link>
        </Button>
      </div>
    </StoreShell>
  );
}
