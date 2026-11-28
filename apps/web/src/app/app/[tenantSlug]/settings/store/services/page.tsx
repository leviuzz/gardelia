import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, ImageIcon, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  getStorefrontServicesSettings,
  hasPermission,
  type StorefrontServiceDto,
} from '@floral/core';
import { STOREFRONT_SERVICE_LIMITS } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { storefrontServiceKey } from '@/lib/storefront-services';
import { getTenantContext } from '@/lib/tenant';
import {
  createStorefrontServiceAction,
  moveStorefrontServiceAction,
  setStorefrontServicePublishedAction,
} from './actions';
import { NewServiceForm } from './service-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('storeServices');
  return { title: t('title') };
}

/**
 * Impostazioni → Negozio online → «Servizi in vetrina» (M5, ADR-089): i quattro predefiniti con il
 * loro interruttore e i servizi della fioreria, con l'ordine in vetrina. Proprietario e gerente.
 */
export default async function StoreServicesPage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/store/services'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;
  const settings = await getStorefrontServicesSettings(ctx);
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);

  function row(service: StorefrontServiceDto, move: { up: boolean; down: boolean } | null) {
    const key = storefrontServiceKey(service);
    // Per i test: il tipo per i predefiniti (stabile anche dopo il primo salvataggio), l'ID per gli altri.
    const testKey = service.kind === 'CUSTOM' ? key : service.kind.toLowerCase();
    const name = service.name ?? t(`serviceNames.${service.kind}`);
    const careBlocked = service.kind === 'CARE' && !settings.careReady && !service.isPublished;
    const photo = service.photos[0];
    return (
      <li
        key={key}
        className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
        data-testid={`service-row-${testKey}`}
      >
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {photo ? (
            <PrivateImage
              src={routes.settings.storeServicePhoto(photo.id, 'thumb')}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {name}
            {service.isPublished ? (
              <Badge variant="success">{t('storeServices.inStore')}</Badge>
            ) : (
              <Badge variant="secondary">{t('storeServices.off')}</Badge>
            )}
          </p>
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {service.description ?? t('storeServices.noDescription')}
          </p>
          {careBlocked ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('storeServices.careNotReady')}{' '}
              <Link
                href={routes.settings.care}
                className="font-medium underline-offset-4 hover:underline"
              >
                {t('storeServices.goToCare')}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {move ? (
            <>
              <ActionButton
                action={moveStorefrontServiceAction.bind(null, slug, service.id!, 'up')}
                variant="outline"
                size="icon-sm"
                disabled={!move.up}
                aria-label={t('storeServices.moveUp', { name })}
                title={t('storeServices.moveUp', { name })}
                icon={<ArrowUp />}
              />
              <ActionButton
                action={moveStorefrontServiceAction.bind(null, slug, service.id!, 'down')}
                variant="outline"
                size="icon-sm"
                disabled={!move.down}
                aria-label={t('storeServices.moveDown', { name })}
                title={t('storeServices.moveDown', { name })}
                icon={<ArrowDown />}
              />
            </>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={routes.settings.storeService(key)}>
              <Pencil aria-hidden="true" />
              {t('storeServices.edit')}
            </Link>
          </Button>
          <ActionButton
            action={setStorefrontServicePublishedAction.bind(null, slug, key, !service.isPublished)}
            variant={service.isPublished ? 'outline' : 'default'}
            size="sm"
            disabled={careBlocked}
            icon={service.isPublished ? <EyeOff /> : <Eye />}
            data-testid={`service-toggle-${testKey}`}
          >
            {service.isPublished ? t('storeServices.unpublish') : t('storeServices.publish')}
          </ActionButton>
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.settings.store}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('store.title')}
      </Link>
      <PageHeader title={t('storeServices.title')} description={t('storeServices.subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('storeServices.presetsTitle')}</CardTitle>
          <CardDescription>{t('storeServices.presetsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">{settings.presets.map((service) => row(service, null))}</ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('storeServices.customTitle')}</CardTitle>
          <CardDescription>
            {t('storeServices.customSubtitle', { max: STOREFRONT_SERVICE_LIMITS.customPerShop })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {settings.custom.length > 0 ? (
            <ul className="space-y-3">
              {settings.custom.map((service, index) =>
                row(service, { up: index > 0, down: index < settings.custom.length - 1 }),
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('storeServices.customEmpty')}</p>
          )}
          {settings.custom.length < STOREFRONT_SERVICE_LIMITS.customPerShop ? (
            <NewServiceForm action={createStorefrontServiceAction.bind(null, slug)} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('storeServices.customLimit', { max: STOREFRONT_SERVICE_LIMITS.customPerShop })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
