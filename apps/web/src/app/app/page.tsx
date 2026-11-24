import { ArrowRight, Info, Plus, RotateCcw, Store } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { hasBuyerAccount, listTenantsPendingDeletion, listUserTenants } from '@floral/core';
import { Logo } from '@/components/brand/logo';
import { ActionButton } from '@/components/form/action-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { accountRoutes, appRoutes, tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';
import { restoreShopAction } from './actions';

/**
 * Ingresso nell'app: nessuna fioreria → "Mi cuenta" per chi compra (ha già aperto il conto
 * cliente), altrimenti la creazione della fioreria; una → diretta; più di una → scelta. Le fiorerie
 * in eliminazione del titolare compaiono qui con "Recuperar" (ADR-074), quindi con una di loro
 * la pagina si mostra sempre.
 */
export default async function AppIndexPage({ searchParams }: PageProps<'/app'>) {
  const user = await requireUser(appRoutes.home);
  const [shops, pending] = await Promise.all([
    listUserTenants(user.id),
    listTenantsPendingDeletion(user.id),
  ]);
  if (pending.length === 0) {
    if (shops.length === 0) {
      redirect((await hasBuyerAccount({ userId: user.id })) ? accountRoutes.home : '/onboarding');
    }
    if (shops.length === 1 && shops[0]) redirect(tenantRoutes(shops[0].slug).home);
  }
  const { eliminacion } = await searchParams;

  const t = await getTranslations();
  const format = await getFormatter();
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Logo />
      {eliminacion === 'programada' ? (
        <Alert variant="info" className="mt-8" data-testid="deletion-scheduled">
          <Info aria-hidden="true" />
          <AlertDescription>{t('onboarding.pendingDeletion.scheduled')}</AlertDescription>
        </Alert>
      ) : null}
      {shops.length > 0 ? (
        <>
          <h1 className="mt-10 font-display text-2xl font-semibold">
            {t('onboarding.chooseTitle')}
          </h1>
          <p className="mt-1 text-muted-foreground">{t('onboarding.chooseSubtitle')}</p>
        </>
      ) : null}
      <ul className="mt-6 space-y-3">
        {shops.map((shop) => (
          <li key={shop.slug}>
            <Link
              href={tenantRoutes(shop.slug).home}
              className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/50"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                <Store className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{shop.displayName}</span>
                <span className="text-sm text-muted-foreground">{t(`roles.${shop.role}`)}</span>
              </span>
              {shop.mode === 'DEMO' ? <Badge variant="warning">{t('common.demo')}</Badge> : null}
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {pending.length > 0 ? (
        <section className="mt-10" aria-labelledby="pending-deletion">
          <h2 id="pending-deletion" className="font-display text-xl font-semibold">
            {t('onboarding.pendingDeletion.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('onboarding.pendingDeletion.subtitle')}
          </p>
          <ul className="mt-4 space-y-3">
            {pending.map((shop) => (
              <li
                key={shop.slug}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-destructive/30 bg-card p-4"
              >
                <span className="min-w-48 flex-1">
                  <span className="block font-medium break-words">{shop.displayName}</span>
                  <span className="text-sm text-muted-foreground">
                    {t('onboarding.pendingDeletion.deleteOn', {
                      date: format.dateTime(shop.deleteAfter, { dateStyle: 'long' }),
                    })}
                  </span>
                </span>
                <ActionButton
                  action={restoreShopAction.bind(null, shop.slug)}
                  icon={<RotateCcw />}
                  variant="outline"
                  aria-label={t('onboarding.pendingDeletion.restoreNamed', {
                    name: shop.displayName,
                  })}
                >
                  {t('onboarding.pendingDeletion.restore')}
                </ActionButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link href="/onboarding">
          <Plus />
          {t('onboarding.createAnother')}
        </Link>
      </Button>
    </main>
  );
}
