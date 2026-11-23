import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { TenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Le viste dei Pedidos (ADR-057, ADR-058): elenco, giorno ("Hoy salen"), ruta e mese. */
export async function OrdersTabs({
  routes,
  current,
}: {
  readonly routes: TenantRoutes;
  readonly current: 'list' | 'day' | 'route' | 'calendar';
}) {
  const t = await getTranslations('orders.tabs');
  const tabs = [
    { key: 'list', href: routes.orders.list() },
    { key: 'day', href: routes.orders.day() },
    { key: 'route', href: routes.orders.route() },
    { key: 'calendar', href: routes.orders.calendar() },
  ] as const;
  return (
    <nav
      aria-label={t('label')}
      className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit print:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'flex-1 rounded-lg px-4 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none',
            current === tab.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
