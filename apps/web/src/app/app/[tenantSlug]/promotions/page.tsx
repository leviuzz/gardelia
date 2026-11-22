import { CalendarDays, Info, Mail, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getOccasionPromo, hasPermission, previewOccasionPromoEmail } from '@floral/core';
import { LOCALE_NAMES, minorToDecimalString } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { updateOccasionPromoAction } from './actions';
import { OccasionPromoForm } from './promo-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('promotions');
  return { title: t('title') };
}

/**
 * Promociones (richiesta del founder, ADR-047): una pagina semplice con lo sconto dell'email
 * automatica per le date speciali dei clienti, come funziona e l'anteprima del messaggio.
 */
export default async function PromotionsPage({
  params,
}: PageProps<'/app/[tenantSlug]/promotions'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'promotions:manage')) return <Forbidden />;

  const view = await getOccasionPromo(ctx);
  const preview = await previewOccasionPromoEmail(ctx);
  const t = await getTranslations('promotions');
  const routes = tenantRoutes(ctx.tenantSlug);
  const { settings } = view;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {view.mode === 'DEMO' ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('demoNotice')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('occasion.title')}</CardTitle>
            <CardDescription>{t('occasion.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OccasionPromoForm
              action={updateOccasionPromoAction.bind(null, ctx.tenantSlug)}
              currency={ctx.currency}
              defaults={{
                enabled: settings.enabled,
                kind: settings.kind,
                percent:
                  settings.kind === 'PERCENT' && settings.value !== null
                    ? String(settings.value)
                    : '',
                amount:
                  settings.kind === 'AMOUNT' && settings.value !== null
                    ? minorToDecimalString(settings.value, ctx.currency)
                    : '',
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('how.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                {t('how.who', {
                  reachable: view.reach.reachable,
                  total: view.reach.customersWithDates,
                })}
              </li>
              <li>{t('how.when')}</li>
              <li>{t('how.validity')}</li>
              <li>{t('how.once')}</li>
              <li>{t('how.unsubscribe')}</li>
            </ul>
            <p className="flex items-center gap-2 font-medium">
              <Mail className="size-4 text-primary" aria-hidden="true" />
              {t('how.sent', { count: view.sentLast30Days })}
            </p>
            <Link
              href={routes.calendar({ view: 'agenda' })}
              className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              {t('how.calendar')}
            </Link>
            {view.hasContact ? null : (
              <Alert variant="info">
                <Info aria-hidden="true" />
                <AlertDescription>
                  {t('noContact')}{' '}
                  <Link href={routes.settings.general} className="font-medium underline">
                    {t('goToSettings')}
                  </Link>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
          <CardDescription>
            {t('preview.subtitle', { language: LOCALE_NAMES[view.emailLocale] })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {preview ? (
            <>
              <p className="text-sm break-words">
                <span className="text-muted-foreground">{t('preview.subject')}</span>{' '}
                <span className="font-medium">{preview.subject}</span>
              </p>
              {/* Il messaggio vero, isolato: niente script, link che non portano da nessuna parte. */}
              <iframe
                title={t('preview.title')}
                sandbox=""
                srcDoc={preview.html}
                className="h-[42rem] w-full rounded-xl border bg-white"
              />
            </>
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              {t('preview.empty')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
