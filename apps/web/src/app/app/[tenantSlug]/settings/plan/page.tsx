import { ArrowLeft, Check, Clock, Info, Lock, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getAiQuota, getTenantPlan, hasPermission, isAiPreviewAvailable } from '@floral/core';
import { BRAND } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getTenantContext } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans');
  return { title: t('title') };
}

type FeatureState = 'included' | 'upgrade' | 'soon';

export default async function PlanPage({ params }: PageProps<'/app/[tenantSlug]/settings/plan'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'billing:read')) return <Forbidden />;
  const plan = await getTenantPlan(ctx);
  const t = await getTranslations();
  const format = await getFormatter();
  const subscription = plan.subscription;
  const planName = (code: 'BASIC' | 'PLUS') => `${BRAND.productName} ${t(`plans.names.${code}`)}`;

  // Le anteprime AI compaiono come incluse solo quando funzionano davvero (provider attivo).
  const aiLive = isAiPreviewAvailable();
  const aiIncluded = plan.entitlements.bouquetBuilder && plan.entitlements.aiPreviewsPerMonth > 0;
  const aiQuota = aiLive && aiIncluded ? await getAiQuota(ctx) : null;
  const aiState: FeatureState = !aiLive ? 'soon' : aiIncluded ? 'included' : 'upgrade';
  const aiBody = aiLive
    ? t('plans.features.aiPreviews.body', { count: plan.entitlements.aiPreviewsPerMonth || 25 })
    : t('plans.features.aiPreviewsSoon.body');

  const features: { key: string; state: FeatureState; body?: string }[] = [
    { key: 'catalog', state: 'included' },
    { key: 'customersQuotes', state: 'included' },
    { key: 'team', state: 'included' },
    { key: 'bouquetBuilder', state: plan.entitlements.bouquetBuilder ? 'included' : 'upgrade' },
    { key: 'aiPreviews', state: aiState, body: aiBody },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/app/${ctx.tenantSlug}/settings`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('settings.title')}
      </Link>
      <PageHeader title={t('plans.title')} description={t('plans.subtitle')} />

      {subscription && !subscription.grantsAccess ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>
            {t('plans.lapsed', {
              plan: planName(subscription.planCode),
              fallback: planName(plan.planCode),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardDescription>{t('plans.current')}</CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-3 font-display text-2xl">
            <span data-testid="current-plan">{planName(plan.planCode)}</span>
            {subscription?.grantsAccess ? (
              <Badge variant="accent" className="font-sans">
                {t(`plans.statuses.${subscription.status}`)}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {subscription?.grantsAccess
              ? subscription.currentPeriodEnd
                ? t('plans.validUntil', {
                    date: format.dateTime(subscription.currentPeriodEnd, {
                      dateStyle: 'long',
                      timeZone: ctx.timezone,
                    }),
                  })
                : t('plans.noEndDate')
              : t('plans.defaultPlan')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-xl border">
            {features.map((feature) => (
              <li key={feature.key} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={
                    feature.state === 'included'
                      ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white'
                      : 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                  }
                  aria-hidden="true"
                >
                  {feature.state === 'included' ? (
                    <Check className="size-3.5" />
                  ) : feature.state === 'upgrade' ? (
                    <Lock className="size-3" />
                  ) : (
                    <Clock className="size-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{t(`plans.features.${feature.key}.title`)}</p>
                  <p className="text-muted-foreground">
                    {feature.body ?? t(`plans.features.${feature.key}.body`)}
                  </p>
                </div>
                <Badge
                  variant={
                    feature.state === 'included'
                      ? 'success'
                      : feature.state === 'upgrade'
                        ? 'outline'
                        : 'muted'
                  }
                >
                  {t(`plans.featureStates.${feature.state}`)}
                </Badge>
              </li>
            ))}
          </ul>
          {aiQuota ? (
            <div
              className="mt-4 space-y-1 rounded-xl bg-muted/40 p-4 text-sm"
              data-testid="ai-usage"
            >
              <p className="font-medium">
                {t('plans.aiUsage', { used: aiQuota.includedUsed, limit: aiQuota.includedLimit })}
              </p>
              {aiQuota.extraRemaining > 0 ? (
                <p className="text-muted-foreground">
                  {t('plans.aiExtra', { count: aiQuota.extraRemaining })}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertDescription>{t('plans.pilotNote', { product: BRAND.productName })}</AlertDescription>
      </Alert>
    </div>
  );
}
