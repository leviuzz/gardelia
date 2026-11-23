import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { StockStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
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

/** Le due sezioni dell'inventario (una sola voce nel menu). */
export function InventoryTabs({
  current,
  stockHref,
  movementsHref,
}: {
  readonly current: 'stock' | 'movements';
  readonly stockHref: string;
  readonly movementsHref: string;
}) {
  const t = useTranslations('inventory.tabs');
  const tabs = [
    { key: 'stock', href: stockHref, label: t('stock') },
    { key: 'movements', href: movementsHref, label: t('movements') },
  ] as const;
  return (
    <nav aria-label={t('label')} className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex-none',
            current === tab.key && 'bg-background text-foreground shadow-xs',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
