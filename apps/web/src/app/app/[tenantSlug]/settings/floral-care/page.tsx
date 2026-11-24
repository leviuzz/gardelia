import { ArrowLeft, MapPinOff, Pencil, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  getCareSettings,
  hasPermission,
  type CareServiceDto,
  type CareSettingsDto,
  type TenantContext,
} from '@floral/core';
import { WEEKDAYS_FROM_MONDAY, isCurrencyCode, minorToDecimalString } from '@floral/domain';
import {
  CareOfferForm,
  CareServiceDialog,
  CareServiceToggle,
  CareSimulator,
  CareSlotAddForm,
  CareSlotArchiveDialog,
  CareSlotEditDialog,
  CareTravelTiersEditor,
} from '@/components/care/care-settings-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addCareTravelTierAction,
  archiveCareSlotAction,
  createCareServiceAction,
  createCareSlotAction,
  removeCareTravelTierAction,
  restoreCareSlotAction,
  setCareServiceActiveAction,
  updateCareServiceAction,
  updateCareSettingsAction,
  updateCareSlotAction,
} from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.settings');
  return { title: t('title') };
}

async function loadSettings(ctx: TenantContext): Promise<CareSettingsDto | null> {
  try {
    return await getCareSettings(ctx);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * Ajustes → Floral Care (ADR-075): tariffe e regole, il simulatore del canone, le fasce di uscita
 * con la capienza, i servizi (la nostra lista più quelli del fiorista) e il sovrapprezzo per
 * distanza. La vede tutta la squadra; la cambia chi gestisce.
 */
export default async function CareSettingsPage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/floral-care'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.settings.general}>
        <ArrowLeft aria-hidden="true" />
        {t('care.settings.back')}
      </Link>
    </Button>
  );
  const settings = await loadSettings(ctx);
  if (!settings) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {back}
        <CareUpsell ctx={ctx} />
      </div>
    );
  }

  const currency = settings.currency;
  const decimal = (minor: number) =>
    minor > 0 && isCurrencyCode(currency) ? minorToDecimalString(minor, currency) : '';
  // 22/11/2026 è una domenica (0): da lì i nomi dei giorni nella lingua di chi guarda.
  const weekdayName = (value: number) => {
    const name = format.dateTime(new Date(Date.UTC(2026, 10, 22 + value, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  };
  const weekdays = WEEKDAYS_FROM_MONDAY.map((value) => ({ value, label: weekdayName(value) }));
  const canWrite = settings.canWrite;
  const slotLabel = (slot: { weekday: number; start: string; end: string }) =>
    t('care.slots.label', { day: weekdayName(slot.weekday), start: slot.start, end: slot.end });
  const activeSlots = settings.slots.filter((slot) => slot.active);
  const archivedSlots = settings.slots.filter((slot) => !slot.active);
  const activeServices = settings.services.filter((service) => service.active);
  const archivedServices = settings.services.filter((service) => !service.active);
  const servicePrice = (service: CareServiceDto) =>
    service.pricing === 'INCLUDED'
      ? t('care.services.included')
      : t(`care.services.priceBy.${service.unit}`, { price: money(service.priceMinor, currency) });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader title={t('care.settings.title')} description={t('care.settings.subtitle')} />
      </div>

      {settings.configured ? null : (
        <Alert variant="info">
          <Sparkles aria-hidden="true" />
          <AlertDescription>{t('care.settings.firstTime')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('care.offer.title')}</CardTitle>
          <CardDescription>{t('care.offer.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CareOfferForm
            action={updateCareSettingsAction.bind(null, slug)}
            currency={currency}
            readOnly={!canWrite}
            deliveryRadiusKm={settings.deliveryRadiusKm}
            defaults={{
              visitFee: decimal(settings.visitFeeMinor),
              careFeeSmall: decimal(settings.careFees.SMALL),
              careFeeMedium: decimal(settings.careFees.MEDIUM),
              careFeeLarge: decimal(settings.careFees.LARGE),
              frequencies: settings.frequencies,
              maxDistanceKm: settings.maxDistanceKm?.toString() ?? '',
              minNoticeHours: String(settings.minNoticeHours),
              missedVisitPolicy: settings.missedVisitPolicy,
              deadPlantPolicy: settings.deadPlantPolicy,
              paymentDueDays: String(settings.paymentDueDays),
              lateCancelHours: String(settings.lateCancelHours),
              termsText: settings.termsText ?? '',
            }}
          />
        </CardContent>
      </Card>

      {settings.configured ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('care.simulator.title')}</CardTitle>
              <CardDescription>{t('care.simulator.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <CareSimulator
                currency={currency}
                visitFeeMinor={settings.visitFeeMinor}
                careFees={settings.careFees}
                frequencies={settings.frequencies}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('care.slots.title')}</CardTitle>
              <CardDescription>{t('care.slots.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 [&>*]:min-w-0">
              {activeSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('care.slots.empty')}</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {activeSlots.map((slot) => {
                    const view = { ...slot, label: slotLabel(slot) };
                    return (
                      <li
                        key={slot.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{view.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('care.slots.capacityLine', { count: slot.capacity })}
                            {slot.upcomingVisits > 0
                              ? ` · ${t('care.slots.upcoming', { count: slot.upcomingVisits })}`
                              : ''}
                          </p>
                        </div>
                        {canWrite ? (
                          <span className="flex shrink-0 gap-1">
                            <CareSlotEditDialog
                              action={updateCareSlotAction.bind(null, slug, slot.id)}
                              slot={view}
                              weekdays={weekdays}
                            />
                            <CareSlotArchiveDialog
                              action={archiveCareSlotAction.bind(null, slug, slot.id)}
                              slot={view}
                            />
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canWrite ? (
                <CareSlotAddForm
                  action={createCareSlotAction.bind(null, slug)}
                  weekdays={weekdays}
                />
              ) : null}
              {archivedSlots.length > 0 ? (
                <details className="rounded-xl border px-4 py-2 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    {t('care.slots.archivedTitle', { count: archivedSlots.length })}
                  </summary>
                  <ul className="mt-2 divide-y">
                    {archivedSlots.map((slot) => (
                      <li key={slot.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-muted-foreground">{slotLabel(slot)}</span>
                        {canWrite ? (
                          <ActionButton
                            action={restoreCareSlotAction.bind(null, slug, slot.id)}
                            size="sm"
                            variant="ghost"
                            icon={<RotateCcw />}
                          >
                            {t('care.slots.restore')}
                          </ActionButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('care.services.title')}</CardTitle>
              <CardDescription>{t('care.services.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 [&>*]:min-w-0">
              {activeServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('care.services.empty')}</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {activeServices.map((service) => (
                    <li
                      key={service.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words">{service.name}</p>
                        {service.description ? (
                          <p className="text-xs text-muted-foreground">{service.description}</p>
                        ) : null}
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <Badge variant={service.pricing === 'INCLUDED' ? 'muted' : 'accent'}>
                          {servicePrice(service)}
                        </Badge>
                        {canWrite ? (
                          <>
                            <CareServiceDialog
                              action={updateCareServiceAction.bind(null, slug, service.id)}
                              idPrefix={`service-${service.id}`}
                              currency={currency}
                              title={t('care.services.editTitle', { name: service.name })}
                              submitLabel={t('common.saveChanges')}
                              defaults={{
                                name: service.name,
                                description: service.description ?? '',
                                pricing: service.pricing,
                                unit: service.unit,
                                price: decimal(service.priceMinor),
                              }}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('care.services.editLabel', { name: service.name })}
                                >
                                  <Pencil />
                                </Button>
                              }
                            />
                            <CareServiceToggle
                              action={setCareServiceActiveAction.bind(
                                null,
                                slug,
                                service.id,
                                false,
                              )}
                              active
                              name={service.name}
                            />
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <CareServiceDialog
                    action={createCareServiceAction.bind(null, slug)}
                    idPrefix="service-new"
                    currency={currency}
                    title={t('care.services.newTitle')}
                    submitLabel={t('care.services.add')}
                    defaults={{
                      name: '',
                      description: '',
                      pricing: 'EXTRA',
                      unit: 'PER_VISIT',
                      price: '',
                    }}
                    trigger={
                      <Button variant="secondary">
                        <Plus />
                        {t('care.services.add')}
                      </Button>
                    }
                  />
                </div>
              ) : null}
              {canWrite && settings.suggestions.length > 0 ? (
                <div className="grid gap-2 rounded-xl bg-muted/50 p-4">
                  <p className="text-sm font-medium">{t('care.services.suggestionsTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('care.services.suggestionsHint')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {settings.suggestions.map((suggestion) => (
                      <CareServiceDialog
                        key={suggestion.key}
                        action={createCareServiceAction.bind(null, slug)}
                        idPrefix={`service-${suggestion.key}`}
                        currency={currency}
                        title={t('care.services.newTitle')}
                        submitLabel={t('care.services.add')}
                        defaults={{
                          presetKey: suggestion.key,
                          name: suggestion.name,
                          description: '',
                          pricing: suggestion.pricing,
                          unit: suggestion.unit,
                          price: '',
                        }}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Plus />
                            {suggestion.name}
                          </Button>
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {archivedServices.length > 0 ? (
                <details className="rounded-xl border px-4 py-2 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    {t('care.services.archivedTitle', { count: archivedServices.length })}
                  </summary>
                  <ul className="mt-2 divide-y">
                    {archivedServices.map((service) => (
                      <li key={service.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-muted-foreground">{service.name}</span>
                        {canWrite ? (
                          <CareServiceToggle
                            action={setCareServiceActiveAction.bind(null, slug, service.id, true)}
                            active={false}
                            name={service.name}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('care.tiers.title')}</CardTitle>
              <CardDescription>{t('care.tiers.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 [&>*]:min-w-0">
              {settings.hasOrigin ? null : (
                <Alert variant="warning">
                  <MapPinOff aria-hidden="true" />
                  <AlertDescription>{t('care.tiers.noLocation')}</AlertDescription>
                </Alert>
              )}
              <CareTravelTiersEditor
                addAction={addCareTravelTierAction.bind(null, slug)}
                currency={currency}
                readOnly={!canWrite}
                tiers={settings.travelTiers.map((tier) => ({
                  id: tier.id,
                  distanceLabel: t('care.tiers.upTo', { km: tier.maxKm }),
                  feeLabel: money(tier.feeMinor, currency),
                  removeAction: removeCareTravelTierAction.bind(null, slug, tier.id),
                }))}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
