import { ChevronRight, Gem, MapPinOff, Sprout, Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  getBuilderSettings,
  getDeliverySettings,
  getEntitlements,
  getPlacesProvider,
  getTenantSettings,
  hasPermission,
} from '@floral/core';
import {
  DELIVERY_LIMITS,
  MX_REGIONS,
  MX_TIMEZONES,
  WEEKDAYS_FROM_MONDAY,
  isCurrencyCode,
  minorToDecimalString,
} from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money, phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addDeliveryFeeTierAction,
  addDeliveryWindowAction,
  removeDeliveryFeeTierAction,
  removeDeliveryWindowAction,
  updateBuilderSettingsAction,
  updateDeliverySettingsAction,
  updateLegalAction,
  updateLocationAction,
  updateProfileAction,
} from './actions';
import {
  DeliveryDefaultsForm,
  DeliveryFeeTiersEditor,
  DeliveryWindowsEditor,
} from './delivery-forms';
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
  const delivery = await getDeliverySettings(ctx);
  const format = await getFormatter();
  // 22/11/2026 è una domenica (0): da lì si ricavano i nomi dei giorni nella lingua di chi guarda.
  const weekdays = WEEKDAYS_FROM_MONDAY.map((value) => {
    const name = format.dateTime(new Date(Date.UTC(2026, 10, 22 + value, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return { value, label: name.charAt(0).toLocaleUpperCase() + name.slice(1) };
  });

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

      {/* Floral Care (ADR-074): tariffe, servizi e fasce di uscita della cura delle piante. */}
      <Link
        href={tenantRoutes(slug).settings.care}
        className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Sprout className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('care.settings.link')}</span>
          <span className="block text-sm text-muted-foreground">{t('care.settings.linkBody')}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </Link>

      {/* "Mi tienda en línea" (ADR-065): la pagina pubblica con i prodotti. */}
      <Link
        href={tenantRoutes(slug).settings.store}
        className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Store className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('store.settingsLink')}</span>
          <span className="block text-sm text-muted-foreground">{t('store.settingsLinkBody')}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </Link>

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

      {/* Ancora per il link della tienda en línea ("la tua sede non è sulla mappa"). */}
      <Card id="location" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t('settings.locationTitle')}</CardTitle>
          <CardDescription>{t('settings.locationSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocationForm
            action={updateLocationAction.bind(null, slug)}
            onMap={delivery.origin !== null}
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
              placeId: location?.placeId ?? '',
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.delivery.title')}</CardTitle>
          <CardDescription>{t('settings.delivery.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8">
          <DeliveryDefaultsForm
            action={updateDeliverySettingsAction.bind(null, slug)}
            currency={tenant.currency}
            weekdays={weekdays}
            defaults={{
              closedWeekdays: delivery.closedWeekdays,
              defaultFee:
                delivery.defaultFeeMinor > 0 && isCurrencyCode(tenant.currency)
                  ? minorToDecimalString(delivery.defaultFeeMinor, tenant.currency)
                  : '',
            }}
          />
          <section className="grid gap-3 border-t pt-6">
            <div>
              <h3 className="text-sm font-medium">{t('settings.delivery.tiersTitle')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('settings.delivery.tiersHint')}
              </p>
            </div>
            {/* Senza la posizione della tienda (o senza Google) le fasce non si possono usare. */}
            {delivery.origin === null ? (
              <Alert variant="warning">
                <MapPinOff aria-hidden="true" />
                <AlertDescription>
                  {getPlacesProvider() === null
                    ? t('settings.delivery.tiersNoGoogle')
                    : t('settings.delivery.tiersNoLocation')}
                </AlertDescription>
              </Alert>
            ) : null}
            <DeliveryFeeTiersEditor
              addAction={addDeliveryFeeTierAction.bind(null, slug)}
              max={DELIVERY_LIMITS.feeTiers}
              currency={tenant.currency}
              tiers={delivery.feeTiers.map((tier) => ({
                id: tier.id,
                distanceLabel: t('settings.delivery.tierUpTo', { km: tier.maxKm }),
                feeLabel: money(tier.feeMinor, tenant.currency),
                removeAction: removeDeliveryFeeTierAction.bind(null, slug, tier.id),
              }))}
            />
          </section>
          <section className="grid gap-3 border-t pt-6">
            <div>
              <h3 className="text-sm font-medium">{t('settings.delivery.windowsTitle')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('settings.delivery.windowsHint')}
              </p>
            </div>
            <DeliveryWindowsEditor
              addAction={addDeliveryWindowAction.bind(null, slug)}
              max={DELIVERY_LIMITS.windows}
              windows={delivery.windows.map((window) => ({
                id: window.id,
                label: t('orders.window', { start: window.start, end: window.end }),
                removeAction: removeDeliveryWindowAction.bind(null, slug, window.id),
              }))}
            />
          </section>
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
