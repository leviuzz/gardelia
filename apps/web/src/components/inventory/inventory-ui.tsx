import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReservationState, StockStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { TenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Colore dello stato della scorta: verde, giallo "por agotarse", rosso "agotado". */
export const STOCK_STATUS_BADGE: Record<StockStatus, BadgeVariant> = {
  OK: 'success',
  LOW: 'warning',
  OUT: 'danger',
};

export function StockStatusBadge({ status }: { readonly status: StockStatus }) {
  const t = useTranslations('inventory.statuses');
  return <Badge variant={STOCK_STATUS_BADGE[status]}>{t(status)}</Badge>;
}

const RESERVATION_STATE_BADGE: Record<ReservationState, BadgeVariant> = {
  ACTIVE: 'success',
  EXPIRED: 'danger',
  USED: 'muted',
  RELEASED: 'muted',
};

/** Stato di un apartado (ADR-062): quando vale ancora, quanto manca alla scadenza. */
export function ReservationStateBadge({
  state,
  daysLeft,
}: {
  readonly state: ReservationState;
  readonly daysLeft: number;
}) {
  const t = useTranslations('inventory.reservations');
  if (state === 'ACTIVE') {
    return (
      <Badge variant={daysLeft <= 1 ? 'warning' : 'success'}>{t('due', { days: daysLeft })}</Badge>
    );
  }
  return <Badge variant={RESERVATION_STATE_BADGE[state]}>{t(`states.${state}`)}</Badge>;
}

/** Le sezioni dell'inventario (una sola voce nel menu). */
export type InventoryTab = 'stock' | 'reservations' | 'purchases' | 'movements';

/**
 * Schede dell'inventario. "Compras" solo per chi le registra: hanno i prezzi (ADR-061). Su
 * telefono stanno in una griglia di due colonne, così i nomi si leggono interi anche a 320 px.
 */
export function InventoryTabs({
  current,
  routes,
  showPurchases,
}: {
  readonly current: InventoryTab;
  readonly routes: TenantRoutes;
  readonly showPurchases: boolean;
}) {
  const t = useTranslations('inventory.tabs');
  const tabs = [
    { key: 'stock', href: routes.inventory.list(), label: t('stock') },
    { key: 'reservations', href: routes.inventory.reservations(), label: t('reservations') },
    ...(showPurchases
      ? [{ key: 'purchases', href: routes.inventory.purchases(), label: t('purchases') }]
      : []),
    { key: 'movements', href: routes.inventory.movements(), label: t('movements') },
  ] as const;
  return (
    <nav
      aria-label={t('label')}
      className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:flex sm:w-fit"
    >
      {tabs.map((tab, index) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'min-w-0 truncate rounded-lg px-2 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4',
            // Numero dispari di schede: l'ultima occupa tutta la riga su telefono.
            tabs.length % 2 === 1 && index === tabs.length - 1 && 'col-span-2',
            current === tab.key && 'bg-background text-foreground shadow-xs',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
