import { ArrowLeft, EyeOff, RotateCcw, Trash2, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getTenantDeletionOverview, hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { requestShopDeletionAction } from './actions';
import { DeleteShopForm } from './delete-shop-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.deleteShop');
  return { title: t('title') };
}

/**
 * "Eliminar florería" (ADR-074): cosa succede, con le date vere, cosa la blocca e la conferma col
 * nome. Solo il titolare.
 */
export default async function DeleteShopPage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/delete'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:delete')) return <Forbidden />;
  const overview = await getTenantDeletionOverview(ctx);
  const t = await getTranslations('settings');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const date = format.dateTime(overview.deleteAfterIfNow, {
    dateStyle: 'long',
    timeZone: ctx.timezone,
  });
  const points = [
    { icon: EyeOff, text: t('deleteShop.hidden') },
    { icon: RotateCcw, text: t('deleteShop.grace', { date }) },
    { icon: Trash2, text: t('deleteShop.final', { date }) },
    { icon: UserRound, text: t('deleteShop.account') },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={routes.settings.general}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('title')}
      </Link>
      <PageHeader
        title={t('deleteShop.pageTitle', { name: ctx.tenantName })}
        description={t('deleteShop.pageSubtitle')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('deleteShop.whatHappens')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {overview.blockers.length > 0 ? (
        <Alert variant="warning" data-testid="delete-blocked">
          <AlertDescription className="space-y-2">
            <p>{t('deleteShop.blocked', { count: overview.openOrders })}</p>
            <Link
              href={routes.orders.list()}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('deleteShop.goToOrders')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>{t('deleteShop.confirmTitle')}</CardTitle>
            <CardDescription>{t('deleteShop.confirmBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteShopForm
              action={requestShopDeletionAction.bind(null, ctx.tenantSlug)}
              shopName={ctx.tenantName}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
