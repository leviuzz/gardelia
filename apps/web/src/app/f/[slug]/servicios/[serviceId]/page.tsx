import { ArrowLeft, Hourglass, LogIn } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { getPlacesProvider, getPublicStoreService, getServiceRequestForm } from '@floral/core';
import { BRAND, MX_REGIONS, SERVICE_REQUEST_LIMITS } from '@floral/domain';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { ProductGallery } from '@/components/public/product-gallery';
import { ServiceRequestForm } from '@/components/public/service-request-form';
import { StoreShell } from '@/components/public/store-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money, phoneForInput } from '@/lib/format';
import { readCartCookie, storeShellProps } from '@/lib/public-store';
import { accountRoutes, publicStoreLinks, publicStoreRoutes, withQuery } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { submitServiceRequestAction } from './actions';

const REGIONS = MX_REGIONS.map(({ code, name }) => ({ code, name }));

/**
 * Un servizio della vetrina (M5, ADR-089): foto, descrizione, cosa include, «Desde $X» e il modulo
 * della richiesta. Per chiedere serve il conto (come per ordinare, D-26): senza, «Entra para
 * solicitar» e si torna qui. Testi nella lingua del mercato della fioreria, come la sua pagina.
 */
export default async function PublicServicePage({
  params,
}: PageProps<'/f/[slug]/servicios/[serviceId]'>) {
  const { slug, serviceId } = await params;
  const detail = await getPublicStoreService(slug, serviceId, { cart: await readCartCookie() });
  if (!detail) notFound();
  const { store, service } = detail;
  const locale = store.locale;
  const links = publicStoreLinks(store.slug);
  const routes = publicStoreRoutes(store.slug);
  const t = await getTranslations({ locale, namespace: 'serviceRequest' });
  const tStore = await getTranslations({ locale, namespace: 'publicStore' });
  const tRoot = await getTranslations({ locale });
  const name = service.name ?? tRoot(`serviceNames.${service.kind}`);
  const here = routes.service(service.id);
  const session = await getSession();
  const form = session
    ? await getServiceRequestForm({ userId: session.user.id, country: 'MX' }, slug, serviceId)
    : null;
  const shell = await storeShellProps(store, tStore('whatsappHello'), links);
  const account = session
    ? { href: accountRoutes.home, label: tStore('accountOrders') }
    : { href: withQuery('/login', { next: here }), label: tStore('accountSignIn') };
  const atLimit = form ? form.openCount >= SERVICE_REQUEST_LIMITS.openPerBuyer : false;

  return (
    <StoreShell {...shell} account={account}>
      <Link
        href={links.home}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tStore('backToStore')}
      </Link>

      <NextIntlClientProvider locale={locale} messages={await getMessages({ locale })}>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <ProductGallery
            name={name}
            photos={service.photoIds.map((photoId) => ({
              id: photoId,
              src: links.servicePhoto(service.id, photoId),
              thumbSrc: links.servicePhoto(service.id, photoId, { thumb: true }),
            }))}
          />
          <div className="min-w-0 space-y-4">
            <h1
              className="font-display text-3xl font-semibold tracking-tight break-words"
              data-testid="service-title"
            >
              {name}
            </h1>
            {service.priceFromMinor !== null ? (
              <p className="text-xl font-semibold tabular-nums">
                {t('priceFrom', { price: money(service.priceFromMinor, store.currency, locale) })}
              </p>
            ) : null}
            {service.description ? (
              <p className="whitespace-pre-line text-muted-foreground">{service.description}</p>
            ) : null}
            {service.includes ? (
              <div>
                <h2 className="text-sm font-semibold">{t('includes')}</h2>
                <p className="mt-1 text-sm whitespace-pre-line">{service.includes}</p>
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">{t('howItWorks', { shop: store.name })}</p>
          </div>
        </div>

        <Card className="mt-8 max-w-3xl" id="solicitar">
          <CardHeader>
            <CardTitle>{t('formTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!session ? (
              <div className="space-y-3" data-testid="service-sign-in">
                <p className="text-sm text-muted-foreground">
                  {t('signInBody', { shop: store.name })}
                </p>
                <Button asChild>
                  <Link href={withQuery('/login', { next: here })}>
                    <LogIn aria-hidden="true" />
                    {t('signIn')}
                  </Link>
                </Button>
              </div>
            ) : !form ? (
              <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
            ) : atLimit ? (
              <Alert variant="warning">
                <Hourglass aria-hidden="true" />
                <AlertDescription className="space-y-2">
                  <p>{t('openLimit', { count: SERVICE_REQUEST_LIMITS.openPerBuyer })}</p>
                  <Link
                    href={accountRoutes.requests.list}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {t('myRequests')}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : (
              <PlacesConfigProvider enabled={getPlacesProvider() !== null} near={null}>
                <ServiceRequestForm
                  action={submitServiceRequestAction.bind(null, store.slug, service.id)}
                  kind={form.service.kind}
                  askDate={form.service.askDate}
                  needsAddress={form.needsAddress}
                  currency={form.store.currency}
                  minDate={form.minDate}
                  maxDate={form.maxDate}
                  windows={form.windows}
                  closedWeekdays={form.closedWeekdays}
                  careFrequencies={form.careFrequencies}
                  regions={REGIONS}
                  buyer={{
                    phone: phoneForInput(form.buyer.phone),
                    addresses: form.buyer.addresses.map((address) => ({
                      id: address.id,
                      label: [address.label, address.addressLine1, address.neighborhood]
                        .filter(Boolean)
                        .join(' · '),
                    })),
                  }}
                />
              </PlacesConfigProvider>
            )}
          </CardContent>
        </Card>
      </NextIntlClientProvider>
    </StoreShell>
  );
}

export async function generateMetadata({
  params,
}: PageProps<'/f/[slug]/servicios/[serviceId]'>): Promise<Metadata> {
  const { slug, serviceId } = await params;
  const detail = await getPublicStoreService(slug, serviceId);
  if (!detail) return { title: BRAND.productName, robots: { index: false, follow: false } };
  const tRoot = await getTranslations({ locale: detail.store.locale });
  const name = detail.service.name ?? tRoot(`serviceNames.${detail.service.kind}`);
  return {
    title: `${name} · ${detail.store.name}`,
    description: detail.service.description ?? undefined,
    robots: { index: false, follow: false },
  };
}
