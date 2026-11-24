import { ShieldCheck, TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getAddressSearchSettings, hasPermission, listUserTenants } from '@floral/core';
import { BRAND } from '@floral/domain';
import { BottomNav, SidebarNav, type NavItem } from '@/components/app-shell/app-nav';
import { TenantSwitcher } from '@/components/app-shell/tenant-switcher';
import { PlacesConfigProvider } from '@/components/form/address-search';
import { UserMenu } from '@/components/app-shell/user-menu';
import { LogoMark } from '@/components/brand/logo';
import { securityRoutes, tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';
import { getTenantContext, getTwoFactorStatus } from '@/lib/tenant';

export default async function TenantLayout({ children, params }: LayoutProps<'/app/[tenantSlug]'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const user = await requireUser();
  const [shops, addressSearch, twoFactor] = await Promise.all([
    listUserTenants(user.id),
    getAddressSearchSettings(ctx),
    // Solo i titolari hanno l'obbligo (ADR-077): gli altri non pagano la query.
    ctx.role === 'OWNER' ? getTwoFactorStatus(user.id) : null,
  ]);
  const t = await getTranslations();
  const format = await getFormatter();

  const routes = tenantRoutes(ctx.tenantSlug);
  const items: NavItem[] = [
    { href: routes.home, label: t('nav.dashboard'), icon: 'dashboard', exact: true },
    // Il lavoro di ogni giorno (ADR-054): su mobile nella barra in basso.
    { href: routes.orders.list(), label: t('nav.orders'), icon: 'orders' },
    { href: routes.quotes.list(), label: t('nav.quotes'), icon: 'quotes' },
    // L'Agenda dei lavori (visite e consegne, ADR-075): nella barra in basso al posto di Clientes,
    // per chi esce a fare visite e consegne dal telefono (decisione del founder del 24/11/2026,
    // ADR-078). I contratti di Floral Care su mobile stanno in "Más".
    { href: routes.agenda.day(), label: t('nav.agenda'), icon: 'agenda' },
    ...(hasPermission(ctx, 'subscriptions:read')
      ? [
          {
            href: routes.subscriptions.list(),
            label: t('nav.care'),
            icon: 'care' as const,
            secondary: true,
          },
        ]
      : []),
    // Funzione Plus: chi non ce l'ha trova l'invito all'upgrade (mai una finta funzione).
    { href: routes.builder.list(), label: t('nav.builder'), icon: 'builder', secondary: true },
    // I clienti si aprono quasi sempre da pedidos e cotizaciones: su mobile nel menu "Más".
    {
      href: routes.customers.list(),
      label: t('nav.customers'),
      icon: 'customers',
      secondary: true,
    },
    // Date speciali dei clienti: su mobile nel menu "Más".
    { href: routes.calendar(), label: t('nav.calendar'), icon: 'calendar', secondary: true },
    ...(hasPermission(ctx, 'promotions:manage')
      ? [
          {
            href: routes.promotions.home,
            label: t('nav.promotions'),
            icon: 'promotions' as const,
            secondary: true,
          },
        ]
      : []),
    // Si usa soprattutto all'inizio: su mobile nel menu "Más" per lasciare posto ai Pedidos.
    { href: routes.catalog.list(), label: t('nav.catalog'), icon: 'catalog', secondary: true },
    // Inventario (ADR-060): una sola voce; su mobile nel menu "Más".
    {
      href: routes.inventory.list(),
      label: t('inventory.nav'),
      icon: 'inventory',
      secondary: true,
    },
    // Reportes (ADR-080): vendite e margini, solo per chi gestisce.
    ...(hasPermission(ctx, 'reports:read')
      ? [
          {
            href: routes.reports(),
            label: t('nav.reports'),
            icon: 'reports' as const,
            secondary: true,
          },
        ]
      : []),
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

        {twoFactor?.deadline && !twoFactor.blocking ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-info-soft px-4 py-2 text-sm text-[oklch(0.35_0.07_245)] lg:px-10 print:hidden"
            data-testid="two-factor-banner"
          >
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {t('security.banner', {
                date: format.dateTime(twoFactor.deadline, { dateStyle: 'long' }),
              })}
            </span>
            <Link
              href={securityRoutes.home({ volver: routes.home })}
              className="font-medium underline underline-offset-2"
            >
              {t('security.bannerAction')}
            </Link>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12 print:max-w-none print:p-0">
          {/* "Buscar dirección" nei form degli indirizzi, se c'è la chiave di Google (ADR-059). */}
          <PlacesConfigProvider enabled={addressSearch.enabled} near={addressSearch.near}>
            {children}
          </PlacesConfigProvider>
        </main>
      </div>

      <BottomNav items={items} label={t('nav.mainNavigation')} moreLabel={t('nav.more')} />
    </div>
  );
}
