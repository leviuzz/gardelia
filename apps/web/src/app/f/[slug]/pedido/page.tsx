import { ArrowLeft, Hourglass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { getCheckoutForm, getPlacesProvider, getPublicStore } from '@floral/core';
import { MARKETPLACE_ORDER_LIMITS, MX_REGIONS } from '@floral/domain';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { StoreShell } from '@/components/public/store-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getBuyerContext } from '@/lib/buyer';
import { phoneForInput } from '@/lib/format';
import { storeShellProps } from '@/lib/public-store';
import { accountRoutes, publicStoreRoutes } from '@/lib/routes';
import { placeOrderAction } from './actions';
import { CheckoutForm } from './checkout-form';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const REGIONS = MX_REGIONS.map(({ code, name }) => ({ code, name }));

/**
 * "Hacer pedido" nella tienda en línea (marketplace, blocco C4, ADR-067). Serve l'accesso: chi non
 * l'ha fatto va al login e torna qui. Si sceglie cosa, come e quando; i prezzi mostrati sono
 * quelli del catalogo, ma il totale lo ricalcola il server. Testi nella lingua del mercato della
 * fioreria, come la sua pagina.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<'/f/[slug]/pedido'>) {
  const { slug } = await params;
  const query = await searchParams;
  const preselected = typeof query.producto === 'string' ? query.producto : null;
  const routes = publicStoreRoutes(slug);
  const buyer = await getBuyerContext(
    routes.checkout(preselected ? { producto: preselected } : undefined),
  );
  const form = await getCheckoutForm(buyer, slug);
  if (!form) {
    // Tienda pubblicata ma senza ordini online: la sua pagina (dove si scrive su WhatsApp).
    if (await getPublicStore(slug)) redirect(routes.home);
    notFound();
  }
  const { store } = form;
  const locale = store.locale;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  const tStore = await getTranslations({ locale, namespace: 'publicStore' });
  const shell = await storeShellProps(store, tStore('whatsappHello'));
  const storeRoutes = publicStoreRoutes(store.slug);
  const atLimit = form.pendingCount >= MARKETPLACE_ORDER_LIMITS.pendingPerStore;

  return (
    <StoreShell {...shell}>
      <Link
        href={storeRoutes.home}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tStore('backToStore')}
      </Link>
      <div className="mt-4 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle', { shop: store.name })}</p>
      </div>

      {atLimit ? (
        <Alert variant="warning" className="mt-6 max-w-2xl">
          <Hourglass aria-hidden="true" />
          <AlertDescription className="space-y-2">
            <p>{t('pendingLimit', { count: MARKETPLACE_ORDER_LIMITS.pendingPerStore })}</p>
            <Link
              href={accountRoutes.home}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('myOrders')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : form.items.length === 0 ? (
        <p className="mt-6 text-muted-foreground">{t('noItems')}</p>
      ) : (
        // I componenti del modulo parlano la lingua della fioreria, come la pagina.
        <NextIntlClientProvider locale={locale} messages={await getMessages({ locale })}>
          <PlacesConfigProvider enabled={getPlacesProvider() !== null} near={null}>
            <CheckoutForm
              action={placeOrderAction.bind(null, store.slug)}
              locale={locale}
              store={{
                name: store.name,
                currency: store.currency,
                pickupAddress: store.pickupAddress,
                paymentMethods: store.paymentMethods,
                paymentInstructions: store.paymentInstructions,
              }}
              items={form.items.map((item) => ({
                id: item.id,
                name: item.name,
                priceMinor: item.priceMinor,
                saleUnit: item.saleUnit,
                availability: item.availability,
                photoSrc: item.photoId
                  ? storeRoutes.photo(item.id, item.photoId, { thumb: true })
                  : null,
              }))}
              delivery={form.delivery}
              buyer={{
                phone: phoneForInput(form.buyer.phone),
                email: form.buyer.email,
                addresses: form.buyer.addresses.map((address) => ({
                  id: address.id,
                  label: [address.label, address.addressLine1, address.neighborhood]
                    .filter(Boolean)
                    .join(' · '),
                  coordinates: address.coordinates,
                })),
              }}
              regions={REGIONS}
              preselected={preselected}
            />
          </PlacesConfigProvider>
        </NextIntlClientProvider>
      )}
    </StoreShell>
  );
}
