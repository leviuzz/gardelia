import { ArrowLeft, Check, Clock, Info, Lock, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getTenantPlan, hasPermission } from '@floral/core';
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

  const features: { key: string; state: FeatureState }[] = [
    { key: 'catalog', state: 'included' },
    { key: 'customersQuotes', state: 'included' },
    { key: 'team', state: 'included' },
    { key: 'bouquetBuilder', state: plan.entitlements.bouquetBuilder ? 'included' : 'upgrade' },
    { key: 'aiPreviews', state: 'soon' },
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
                  <p className="text-muted-foreground">{t(`plans.features.${feature.key}.body`)}</p>
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
        </CardContent>
      </Card>

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertDescription>{t('plans.pilotNote', { product: BRAND.productName })}</AlertDescription>
      </Alert>
    </div>
  );
}
