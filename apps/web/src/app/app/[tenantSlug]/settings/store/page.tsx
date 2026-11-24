import { ArrowLeft, Check, CircleAlert, EyeOff, Globe, MapPinOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getOnlineStoreSettings, getPlacesProvider, hasPermission } from '@floral/core';
import { whatsappShareLink } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverEnv } from '@/lib/env';
import { publicStoreRoutes, tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  removeStoreImageAction,
  setOnlineStorePublishedAction,
  updateOnlineOrderSettingsAction,
  updateOnlineStoreAction,
  uploadStoreImageAction,
} from '../actions';
import { OnlineOrdersForm, StoreImageField, StoreInfoForm, StoreLinkCard } from './store-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('store');
  return { title: t('title') };
}

/**
 * "Mi tienda en línea" (marketplace, blocco C2, ADR-065): stato della pagina pubblica, cosa manca
 * per pubblicarla, ordini online (C4, ADR-067), presentazione e forme di pagamento.
 */
export default async function StoreSettingsPage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/store'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;
  const settings = await getOnlineStoreSettings(ctx);
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const url = `${serverEnv().APP_URL.replace(/\/+$/, '')}${publicStoreRoutes(slug).home}`;
  const blockers = new Set(settings.blockers);

  const requirements = [
    {
      key: 'items',
      done: !blockers.has('store_needs_items'),
      label: t('store.requirementItems', { count: settings.onlineItems }),
      href: routes.catalog.list(),
      action: t('store.goToCatalog'),
    },
    {
      key: 'contact',
      done: !blockers.has('store_needs_contact'),
      label: t('store.requirementContact'),
      href: routes.settings.general,
      action: t('store.goToProfile'),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.settings.general}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('settings.title')}
      </Link>
      <PageHeader title={t('store.title')} description={t('store.subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t('store.statusTitle')}
            {settings.isPublished ? (
              <Badge variant="success">{t('store.published')}</Badge>
            ) : (
              <Badge variant="secondary">{t('store.notPublished')}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {settings.isPublished ? t('store.publishedBody') : t('store.notPublishedBody')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Senza la posizione di Google la tienda la trova solo chi cerca la città (ADR-066). */}
          {!settings.onMap && getPlacesProvider() !== null ? (
            <Alert variant="warning" data-testid="store-off-map">
              <MapPinOff aria-hidden="true" />
              <AlertDescription className="space-y-1">
                <p>{t('store.offMap')}</p>
                <Link
                  href={`${routes.settings.general}#location`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t('store.offMapAction')}
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          {settings.isPublished ? (
            <>
              <StoreLinkCard
                url={url}
                whatsappHref={whatsappShareLink(t('store.shareText', { url }))}
              />
              <ConfirmActionDialog
                action={setOnlineStorePublishedAction.bind(null, slug, false)}
                title={t('store.unpublishTitle')}
                description={t('store.unpublishBody')}
                confirmLabel={t('store.unpublish')}
                trigger={
                  <Button variant="ghost">
                    <EyeOff />
                    {t('store.unpublish')}
                  </Button>
                }
              />
            </>
          ) : (
            <>
              <ul className="grid gap-2">
                {requirements.map((item) => (
                  <li
                    key={item.key}
                    className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm"
                  >
                    {item.done ? (
                      <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      {item.label}
                      <span className="sr-only">
                        {item.done ? ` · ${t('store.done')}` : ` · ${t('store.missing')}`}
                      </span>
                    </span>
                    {item.done ? null : (
                      <Link href={item.href} className="font-medium text-primary hover:underline">
                        {item.action}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <ActionButton
                action={setOnlineStorePublishedAction.bind(null, slug, true)}
                icon={<Globe />}
                disabled={settings.blockers.length > 0}
              >
                {t('store.publish')}
              </ActionButton>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t('store.orders.title')}
            {settings.ordersEnabled ? (
              <Badge variant="success">{t('store.orders.on')}</Badge>
            ) : (
              <Badge variant="secondary">{t('store.orders.off')}</Badge>
            )}
          </CardTitle>
          <CardDescription>{t('store.orders.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {settings.pendingOrders > 0 ? (
            <p className="text-sm">
              <Link
                href={routes.orders.list({ when: 'pending' })}
                className="font-medium text-primary hover:underline"
              >
                {t('store.orders.pending', { count: settings.pendingOrders })}
              </Link>
            </p>
          ) : null}
          {!settings.ordersEnabled && settings.ordersBlockers.length > 0 ? (
            <ul className="grid gap-2">
              {settings.ordersBlockers.map((blocker) => (
                <li
                  key={blocker}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm"
                >
                  <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{t(`store.orders.blockers.${blocker}`)}</span>
                  <Link
                    href={
                      blocker === 'store_needs_payment' ? '#store-info' : routes.settings.general
                    }
                    className="font-medium text-primary hover:underline"
                  >
                    {blocker === 'store_needs_payment'
                      ? t('store.orders.goToPayment')
                      : t('store.goToProfile')}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <OnlineOrdersForm
            action={updateOnlineOrderSettingsAction.bind(null, slug)}
            canEnable={settings.ordersBlockers.length === 0}
            defaults={{ ordersEnabled: settings.ordersEnabled, minLeadDays: settings.minLeadDays }}
          />
          {settings.ordersEnabled && !settings.isPublished ? (
            <p className="text-sm text-muted-foreground">{t('store.orders.notPublished')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('store.imagesTitle')}</CardTitle>
          <CardDescription>{t('store.imagesSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <StoreImageField
            kind="LOGO"
            imageSrc={settings.logoId ? routes.settings.storeImage('LOGO', settings.logoId) : null}
            upload={uploadStoreImageAction.bind(null, slug, 'LOGO')}
            removeAction={removeStoreImageAction.bind(null, slug, 'LOGO')}
          />
          <StoreImageField
            kind="COVER"
            imageSrc={
              settings.coverId ? routes.settings.storeImage('COVER', settings.coverId) : null
            }
            upload={uploadStoreImageAction.bind(null, slug, 'COVER')}
            removeAction={removeStoreImageAction.bind(null, slug, 'COVER')}
          />
        </CardContent>
      </Card>

      <Card id="store-info" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{t('store.infoTitle')}</CardTitle>
          <CardDescription>{t('store.infoSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <StoreInfoForm
            action={updateOnlineStoreAction.bind(null, slug)}
            defaults={{
              description: settings.description ?? '',
              paymentMethods: settings.paymentMethods,
              paymentInstructions: settings.paymentInstructions ?? '',
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('store.productsTitle')}</CardTitle>
          <CardDescription>{t('store.productsBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{t('store.productsCount', { count: settings.onlineItems })}</p>
          <Button asChild variant="outline" className="mt-3">
            <Link href={routes.catalog.list()}>{t('store.goToCatalog')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
