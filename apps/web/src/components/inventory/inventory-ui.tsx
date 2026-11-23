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

/**
 * Le sezioni dell'inventario (una sola voce nel menu). "Compras" solo per chi le registra: hanno
 * i prezzi (ADR-061).
 */
export function InventoryTabs({
  current,
  stockHref,
  movementsHref,
  purchasesHref,
}: {
  readonly current: 'stock' | 'purchases' | 'movements';
  readonly stockHref: string;
  readonly movementsHref: string;
  readonly purchasesHref?: string | undefined;
}) {
  const t = useTranslations('inventory.tabs');
  const tabs = [
    { key: 'stock', href: stockHref, label: t('stock') },
    ...(purchasesHref ? [{ key: 'purchases', href: purchasesHref, label: t('purchases') }] : []),
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
            'min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex-none sm:px-4',
            current === tab.key && 'bg-background text-foreground shadow-xs',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
