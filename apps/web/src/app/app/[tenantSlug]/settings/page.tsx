import { ChevronRight, Gem } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  getBuilderSettings,
  getEntitlements,
  getTenantSettings,
  hasPermission,
} from '@floral/core';
import { MX_REGIONS, MX_TIMEZONES, isCurrencyCode, minorToDecimalString } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  updateBuilderSettingsAction,
  updateLegalAction,
  updateLocationAction,
  updateProfileAction,
} from './actions';
import { BuilderSettingsForm, LegalForm, LocationForm, ProfileForm } from './settings-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage({ params }: PageProps<'/app/[tenantSlug]/settings'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;

  const { tenant, location } = await getTenantSettings(ctx);
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const canEditLegal = hasPermission(ctx, 'tenant:legal:update');
  // Il cargo per l'armado esiste solo se il piano include il Builder.
  const builder = (await getEntitlements(ctx)).bouquetBuilder
    ? await getBuilderSettings(ctx)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />

      {hasPermission(ctx, 'billing:read') ? (
        <Link
          href={tenantRoutes(slug).settings.plan}
          className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Gem className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t('plans.settingsLink')}</span>
            <span className="block text-sm text-muted-foreground">
              {t('plans.settingsLinkBody')}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.profileTitle')}</CardTitle>
          <CardDescription>{t('settings.profileSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('settings.shopUrl')}</dt>
              <dd className="font-mono text-xs">{tenantRoutes(tenant.slug).home}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('settings.currency')}</dt>
              <dd className="font-medium">{tenant.currency}</dd>
            </div>
          </dl>
          <ProfileForm
            action={updateProfileAction.bind(null, slug)}
            timezones={MX_TIMEZONES.map((id) => ({ id, label: t(`timezones.${id}`) }))}
            defaults={{
              displayName: tenant.displayName,
              contactEmail: tenant.contactEmail ?? '',
              contactPhone: phoneForInput(tenant.contactPhone),
              timezone: tenant.timezone,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.locationTitle')}</CardTitle>
          <CardDescription>{t('settings.locationSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocationForm
            action={updateLocationAction.bind(null, slug)}
            regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
            defaults={{
              addressLine1: location?.addressLine1 ?? '',
              addressLine2: location?.addressLine2 ?? '',
              neighborhood: location?.neighborhood ?? '',
              city: location?.city ?? '',
              region: location?.region ?? 'AGU',
              postalCode: location?.postalCode ?? '',
              phone: phoneForInput(location?.phone ?? null),
              deliveryRadiusKm: location?.deliveryRadiusKm?.toString() ?? '',
            }}
          />
        </CardContent>
      </Card>

      {builder ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('builder.settings.title')}</CardTitle>
            <CardDescription>{t('builder.settings.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <BuilderSettingsForm
              action={updateBuilderSettingsAction.bind(null, slug)}
              currency={tenant.currency}
              laborFee={
                builder.laborFeeMinor > 0 && isCurrencyCode(tenant.currency)
                  ? minorToDecimalString(builder.laborFeeMinor, tenant.currency)
                  : ''
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.legalTitle')}</CardTitle>
          <CardDescription>
            {canEditLegal ? t('settings.legalSubtitle') : t('settings.legalReadOnly')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LegalForm
            action={updateLegalAction.bind(null, slug)}
            readOnly={!canEditLegal}
            defaults={{ legalName: tenant.legalName ?? '', taxId: tenant.taxId ?? '' }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
