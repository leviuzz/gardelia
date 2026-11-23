import { ArrowLeft, Flower2, MessageCircle, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPublicStoreItem } from '@floral/core';
import { BRAND, isCatalogColor, whatsappLink } from '@floral/domain';
import { StoreShell } from '@/components/public/store-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { storeShellProps } from '@/lib/public-store';
import { publicStoreRoutes } from '@/lib/routes';

export async function generateMetadata({
  params,
}: PageProps<'/f/[slug]/p/[itemId]'>): Promise<Metadata> {
  const { slug, itemId } = await params;
  const detail = await getPublicStoreItem(slug, itemId);
  if (!detail) return { title: BRAND.productName };
  return {
    title: `${detail.item.name} · ${detail.store.name}`,
    description: detail.item.description ?? undefined,
  };
}

/**
 * Un prodotto della pagina pubblica (ADR-065): foto, prezzo, di cosa è fatto, e "Pedir por
 * WhatsApp" con il nome e il link già scritti; con gli ordini online (C4, ADR-067) anche "Pedir en
 * línea", che apre il modulo con il prodotto già scelto.
 */
export default async function PublicStoreItemPage({ params }: PageProps<'/f/[slug]/p/[itemId]'>) {
  const { slug, itemId } = await params;
  const detail = await getPublicStoreItem(slug, itemId);
  if (!detail) notFound();
  const { store, item } = detail;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'publicStore' });
  const tCatalog = await getTranslations({ locale, namespace: 'catalog' });
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

  return (
    <StoreShell {...shell}>
      <Link
        href={routes.home}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('backToStore')}
      </Link>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-muted">
            {item.photoId ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app.
              <img
                src={routes.photo(item.id, item.photoId)}
                alt={t('photoAlt', { name: item.name })}
                className="size-full object-cover"
              />
            ) : (
              <Flower2 className="size-14 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          {item.photoIds.length > 1 ? (
            <ul className="grid grid-cols-4 gap-2">
              {item.photoIds.slice(1).map((photoId) => (
                <li
                  key={photoId}
                  className="aspect-square overflow-hidden rounded-xl border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app. */}
                  <img
                    src={routes.photo(item.id, photoId, { thumb: true })}
                    alt={t('photoAlt', { name: item.name })}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{item.name}</h1>
            <p className="mt-2 text-xl font-semibold tabular-nums">{price}</p>
            {item.availability !== 'AVAILABLE' ? (
              <Badge
                className="mt-2"
                variant={item.availability === 'OUT_OF_STOCK' ? 'muted' : 'warning'}
              >
                {t(`availability.${item.availability}`)}
              </Badge>
            ) : null}
          </div>

          {item.description ? (
            <p className="leading-relaxed whitespace-pre-line">{item.description}</p>
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

          {store.ordersEnabled && item.availability !== 'OUT_OF_STOCK' ? (
            <div className="space-y-2">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href={routes.checkout({ producto: item.id })}>
                  <ShoppingBag />
                  {t('orderOnline')}
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">{t('orderHow')}</p>
            </div>
          ) : null}

          {store.phone && item.availability !== 'OUT_OF_STOCK' ? (
            <div className="space-y-2">
              <Button
                asChild
                size="lg"
                variant={store.ordersEnabled ? 'outline' : 'default'}
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
    </StoreShell>
  );
}
