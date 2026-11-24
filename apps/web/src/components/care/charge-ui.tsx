import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { CareChargeStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { TenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

const CHARGE_BADGE: Record<CareChargeStatus, BadgeVariant> = {
  PENDING: 'info',
  PARTIAL: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
  NO_BALANCE: 'muted',
  IN_FAVOR: 'accent',
  REFUNDED: 'secondary',
};

/** Stato di un cargo di Floral Care (ADR-081): calcolato in lettura, "Vencido" dopo la scadenza. */
export function ChargeStatusBadge({ status }: { readonly status: CareChargeStatus }) {
  const t = useTranslations('care.chargeStatus');
  return <Badge variant={CHARGE_BADGE[status]}>{t(status)}</Badge>;
}

/**
 * Le due pagine di Floral Care fuori dall'Agenda: i contratti e, per chi gestisce i soldi, i cobros
 * (ADR-081).
 */
export function CareTabs({
  routes,
  current,
}: {
  readonly routes: TenantRoutes;
  readonly current: 'contracts' | 'charges';
}) {
  const t = useTranslations('care.tabs');
  const tabs = [
    { key: 'contracts', href: routes.subscriptions.list(), label: t('contracts') },
    { key: 'charges', href: routes.subscriptions.charges(), label: t('charges') },
  ] as const;
  return (
    <nav
      aria-label={t('label')}
      className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit print:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'flex-1 rounded-lg px-2.5 py-1.5 text-center text-sm font-medium whitespace-nowrap transition-colors sm:flex-none sm:px-4',
            current === tab.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
