import { Archive, ArrowLeft, Eye, EyeOff, ExternalLink, ImageIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getStorefrontServicesSettings, hasPermission } from '@floral/core';
import { STOREFRONT_SERVICE_LIMITS, minorToDecimalString, type CurrencyCode } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { PrivateImage } from '@/components/common/private-image';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { RemovePhotoButton } from '@/components/photos/photo-upload-parts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { publicStoreRoutes, tenantRoutes } from '@/lib/routes';
import { storefrontServiceKey, storefrontServiceTarget } from '@/lib/storefront-services';
import { getTenantContext } from '@/lib/tenant';
import {
  archiveStorefrontServiceAction,
  removeStorefrontServicePhotoAction,
  saveStorefrontServiceAction,
  setStorefrontServicePublishedAction,
  uploadStorefrontServicePhotoAction,
} from '../actions';
import { ServicePhotoUploader, ServiceTextsForm } from '../service-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('storeServices');
  return { title: t('title') };
}

/**
 * La scheda di un servizio in vetrina (M5): testi, foto (fino a 6), acceso o spento; un servizio
 * della fioreria si archivia. Un predefinito mai salvato si apre col suo tipo nell'indirizzo.
 */
export default async function StoreServicePage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/store/services/[service]'>) {
  const { tenantSlug, service: key } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;
  const target = storefrontServiceTarget(key);
  if (!target) notFound();
  const settings = await getStorefrontServicesSettings(ctx);
  const service = [...settings.presets, ...settings.custom].find((candidate) =>
    'kind' in target ? candidate.kind === target.kind : candidate.id === target.serviceId,
  );
  // Un ID che non è un servizio attivo della fioreria: come un indirizzo che non esiste.
  if (!service) notFound();
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const serviceKey = storefrontServiceKey(service);
  const custom = service.kind === 'CUSTOM';
  const name = service.name ?? t(`serviceNames.${service.kind}`);
  const careBlocked = service.kind === 'CARE' && !settings.careReady && !service.isPublished;
  const remaining = STOREFRONT_SERVICE_LIMITS.photos - service.photos.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.settings.storeServices}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('storeServices.title')}
      </Link>
      <PageHeader
        title={name}
        description={custom ? t('storeServices.customHint') : t('storeServices.presetHint')}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t('storeServices.statusTitle')}
            {service.isPublished ? (
              <Badge variant="success">{t('storeServices.inStore')}</Badge>
            ) : (
              <Badge variant="secondary">{t('storeServices.off')}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {service.isPublished ? t('storeServices.publishedBody') : t('storeServices.offBody')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {careBlocked ? (
            <p className="w-full text-sm text-muted-foreground">
              {t('storeServices.careNotReady')}{' '}
              <Link
                href={routes.settings.care}
                className="font-medium underline-offset-4 hover:underline"
              >
                {t('storeServices.goToCare')}
              </Link>
            </p>
          ) : null}
          <ActionButton
            action={setStorefrontServicePublishedAction.bind(
              null,
              slug,
              serviceKey,
              !service.isPublished,
            )}
            variant={service.isPublished ? 'outline' : 'default'}
            disabled={careBlocked}
            icon={service.isPublished ? <EyeOff /> : <Eye />}
            data-testid="service-publish"
          >
            {service.isPublished ? t('storeServices.unpublish') : t('storeServices.publish')}
          </ActionButton>
          {service.isPublished && service.id ? (
            <Button asChild variant="ghost">
              <a
                href={publicStoreRoutes(slug).service(service.id)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink aria-hidden="true" />
                {t('storeServices.open')}
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('storeServices.textsTitle')}</CardTitle>
          <CardDescription>{t('storeServices.textsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceTextsForm
            action={saveStorefrontServiceAction.bind(null, slug, serviceKey)}
            custom={custom}
            currency={settings.currency}
            defaults={{
              name: service.name ?? '',
              description: service.description ?? '',
              includes: service.includes ?? '',
              priceFrom:
                service.priceFromMinor === null
                  ? ''
                  : minorToDecimalString(service.priceFromMinor, settings.currency as CurrencyCode),
              askDate: service.askDate,
              askAddress: service.askAddress,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('storeServices.photos.title')}</CardTitle>
          <CardDescription>{t('storeServices.photos.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {service.photos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              <ImageIcon className="size-6" aria-hidden="true" />
              {t('storeServices.photos.empty')}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="service-photos">
              {service.photos.map((photo, index) => (
                <li key={photo.id} className="relative">
                  <PrivateImage
                    src={routes.settings.storeServicePhoto(photo.id, 'thumb')}
                    alt={t('storeServices.photos.alt', { name, index: index + 1 })}
                    className="aspect-square w-full rounded-xl border bg-muted object-cover"
                  />
                  <div className="absolute top-2 right-2">
                    <RemovePhotoButton
                      action={removeStorefrontServicePhotoAction.bind(
                        null,
                        slug,
                        serviceKey,
                        photo.id,
                      )}
                      label={t('storeServices.photos.remove')}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {remaining > 0 ? (
            <ServicePhotoUploader
              upload={uploadStorefrontServicePhotoAction.bind(null, slug, serviceKey)}
              remaining={remaining}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('storeServices.photos.full', { max: STOREFRONT_SERVICE_LIMITS.photos })}
            </p>
          )}
        </CardContent>
      </Card>

      {custom && service.id ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('storeServices.archiveTitle')}</CardTitle>
            <CardDescription>{t('storeServices.archiveBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmActionDialog
              title={t('storeServices.archiveConfirmTitle', { name })}
              description={t('storeServices.archiveConfirmBody')}
              confirmLabel={t('storeServices.archive')}
              action={archiveStorefrontServiceAction.bind(null, slug, service.id)}
              trigger={
                <Button variant="outline">
                  <Archive aria-hidden="true" />
                  {t('storeServices.archive')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
