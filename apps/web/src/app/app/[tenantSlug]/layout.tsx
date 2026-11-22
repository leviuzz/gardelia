import { TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hasPermission, listUserTenants } from '@floral/core';
import { BRAND } from '@floral/domain';
import { BottomNav, SidebarNav, type NavItem } from '@/components/app-shell/app-nav';
import { TenantSwitcher } from '@/components/app-shell/tenant-switcher';
import { UserMenu } from '@/components/app-shell/user-menu';
import { LogoMark } from '@/components/brand/logo';
import { tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';
import { getTenantContext } from '@/lib/tenant';

export default async function TenantLayout({ children, params }: LayoutProps<'/app/[tenantSlug]'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const user = await requireUser();
  const shops = await listUserTenants(user.id);
  const t = await getTranslations();

  const routes = tenantRoutes(ctx.tenantSlug);
  const items: NavItem[] = [
    { href: routes.home, label: t('nav.dashboard'), icon: 'dashboard', exact: true },
    { href: routes.quotes.list(), label: t('nav.quotes'), icon: 'quotes' },
    // Funzione Plus: chi non ce l'ha trova l'invito all'upgrade (mai una finta funzione).
    { href: routes.builder.list(), label: t('nav.builder'), icon: 'builder', secondary: true },
    { href: routes.customers.list(), label: t('nav.customers'), icon: 'customers' },
    // Date speciali dei clienti: su mobile nel menu "Más".
    { href: routes.calendar(), label: t('nav.calendar'), icon: 'calendar', secondary: true },
    { href: routes.catalog.list(), label: t('nav.catalog'), icon: 'catalog' },
    // Sezioni d'uso occasionale: su mobile finiscono nel menu "Más".
    ...(hasPermission(ctx, 'members:read')
      ? [
          {
            href: routes.settings.team,
            label: t('nav.team'),
            icon: 'team' as const,
            secondary: true,
          },
        ]
      : []),
    ...(hasPermission(ctx, 'tenant:settings:update')
      ? [
          {
            href: routes.settings.general,
            label: t('nav.settings'),
            icon: 'settings' as const,
            exclude: [routes.settings.team],
            secondary: true,
          },
        ]
      : []),
  ];
  const current = { slug: ctx.tenantSlug, displayName: ctx.tenantName };
  const roleLabel = t(`roles.${ctx.role}`);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] print:block">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex print:hidden!">
        <Link href={routes.home} className="flex items-center gap-2.5 px-1">
          <LogoMark />
          <span className="font-display text-lg font-semibold tracking-tight">
            {BRAND.productName}
          </span>
        </Link>
        <TenantSwitcher current={current} shops={shops} />
        <SidebarNav items={items} label={t('nav.mainNavigation')} />
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <UserMenu name={user.name} email={user.email} roleLabel={roleLabel} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden print:hidden">
          <Link href={routes.home} aria-label={t('nav.dashboard')}>
            <LogoMark className="size-7" />
          </Link>
          <div className="min-w-0 flex-1">
            <TenantSwitcher current={current} shops={shops} />
          </div>
          <UserMenu name={user.name} email={user.email} roleLabel={roleLabel} compact />
        </header>

        {ctx.mode === 'DEMO' ? (
          <div className="flex items-center gap-2 border-b bg-warning-soft px-4 py-2 text-sm text-[oklch(0.38_0.09_65)] lg:px-10 print:hidden">
            <TriangleExclamationPoint className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('common.demoBanner')}</span>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12 print:max-w-none print:p-0">
          {children}
        </main>
      </div>

      <BottomNav items={items} label={t('nav.mainNavigation')} moreLabel={t('nav.more')} />
    </div>
  );
}
