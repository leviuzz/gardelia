import { ArrowRight, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { hasBuyerAccount, listUserTenants } from '@floral/core';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { accountRoutes, tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';

/**
 * Ingresso nell'app: nessuna fioreria → "Mi cuenta" per chi compra (ha già aperto il conto
 * cliente), altrimenti la creazione della fioreria; una → diretta; più di una → scelta.
 */
export default async function AppIndexPage() {
  const user = await requireUser('/app');
  const shops = await listUserTenants(user.id);
  if (shops.length === 0) {
    redirect((await hasBuyerAccount({ userId: user.id })) ? accountRoutes.home : '/onboarding');
  }
  if (shops.length === 1 && shops[0]) redirect(tenantRoutes(shops[0].slug).home);

  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Logo />
      <h1 className="mt-10 font-display text-2xl font-semibold">{t('onboarding.chooseTitle')}</h1>
      <p className="mt-1 text-muted-foreground">{t('onboarding.chooseSubtitle')}</p>
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
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link href="/onboarding">
          <Plus />
          {t('onboarding.createAnother')}
        </Link>
      </Button>
    </main>
  );
}
