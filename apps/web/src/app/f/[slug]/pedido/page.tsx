import { ArrowLeft, Hourglass, Info, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { getCheckoutForm, getPlacesProvider } from '@floral/core';
import { MARKETPLACE_ORDER_LIMITS, MX_REGIONS, isUuid, setCartLine } from '@floral/domain';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { StoreShell } from '@/components/public/store-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getBuyerContext } from '@/lib/buyer';
import { phoneForInput } from '@/lib/format';
import { loadPublicStore, readCartCookie, storeShellProps } from '@/lib/public-store';
import { accountRoutes, publicStoreRoutes } from '@/lib/routes';
import { storePolicies } from '@/lib/storefront-ui';
import { placeOrderAction } from './actions';
import { CheckoutForm } from './checkout-form';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const REGIONS = MX_REGIONS.map(({ code, name }) => ({ code, name }));

/** Un conteggio dall'indirizzo (`?omitidos=2`): solo interi piccoli, altrimenti 0. */
function smallCount(value: string | string[] | undefined): number {
  const text = typeof value === 'string' ? value : '';
  return /^\d{1,2}$/.test(text) ? Number(text) : 0;
}

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
  const preselected =
    typeof query.producto === 'string' && isUuid(query.producto) ? query.producto : null;
  const routes = publicStoreRoutes(slug);
  const buyer = await getBuyerContext(
    routes.checkout(preselected ? { producto: preselected } : undefined),
  );
  // Il carrello della vetrina (cookie, M1); un link con `?producto=` (es. condiviso su WhatsApp)
  // aggiunge quel prodotto se non c'è già.
  let cart = await readCartCookie();
  if (preselected && !cart.some((line) => line.itemId === preselected)) {
    cart = setCartLine(cart, preselected, 1).lines;
  }
  const form = await getCheckoutForm(buyer, slug, { cart });
  if (!form) {
    // Tienda pubblicata ma senza ordini online: la sua pagina (dove si scrive su WhatsApp).
    if (await loadPublicStore(slug)) redirect(routes.home);
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
      ) : form.delivery.firstDate === null ? (
        <p className="mt-6 text-muted-foreground">{t('noDates')}</p>
      ) : (
        // I componenti del modulo parlano la lingua della fioreria, come la pagina.
        <NextIntlClientProvider locale={locale} messages={await getMessages({ locale })}>
          {/* «Pedir de nuevo» dal conto (M3): i prodotti dell'ordine sono nel carrello. */}
          {query.repetido === '1' ? (
            <Alert variant="success" className="mt-6 max-w-3xl" data-testid="cart-reordered">
              <RotateCcw aria-hidden="true" />
              <AlertDescription className="space-y-1">
                <p>{t('reorder.added')}</p>
                {smallCount(query.omitidos) > 0 ? (
                  <p>{t('reorder.skipped', { count: smallCount(query.omitidos) })}</p>
                ) : null}
                {smallCount(query.llenos) > 0 ? (
                  <p>{t('reorder.full', { count: smallCount(query.llenos) })}</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {form.cart.dropped > 0 ? (
            <Alert variant="info" className="mt-6 max-w-3xl" data-testid="cart-dropped">
              <Info aria-hidden="true" />
              <AlertDescription>{t('cartDropped', { count: form.cart.dropped })}</AlertDescription>
            </Alert>
          ) : null}
          <PlacesConfigProvider enabled={getPlacesProvider() !== null} near={null}>
            <CheckoutForm
              action={placeOrderAction.bind(null, store.slug)}
              slug={store.slug}
              locale={locale}
              store={{
                name: store.name,
                currency: store.currency,
                pickupAddress: store.pickupAddress,
                paymentMethods: store.paymentMethods,
                paymentInstructions: store.paymentInstructions,
                policies: storePolicies(store, tStore),
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
              initialQuantities={form.cart.lines}
            />
          </PlacesConfigProvider>
        </NextIntlClientProvider>
      )}
    </StoreShell>
  );
}
