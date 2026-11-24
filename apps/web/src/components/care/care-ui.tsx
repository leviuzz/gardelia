import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { CareVisitStatus, CustomerSubscriptionStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { TenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

const CONTRACT_BADGE: Record<CustomerSubscriptionStatus, BadgeVariant> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'secondary',
  CANCELLED: 'muted',
};

const VISIT_BADGE: Record<CareVisitStatus, BadgeVariant> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'accent',
  DONE: 'success',
  NOT_DONE: 'warning',
  CANCELLED: 'muted',
  TO_RESCHEDULE: 'danger',
};

/** Stato di un contratto di Floral Care (elenco, scheda, scheda del cliente). */
export function ContractStatusBadge({ status }: { readonly status: CustomerSubscriptionStatus }) {
  const t = useTranslations('care.contractStatus');
  return <Badge variant={CONTRACT_BADGE[status]}>{t(status)}</Badge>;
}

/** Stato di una visita (Agenda, scheda del contratto). */
export function VisitStatusBadge({ status }: { readonly status: CareVisitStatus }) {
  const t = useTranslations('care.visitStatus');
  return <Badge variant={VISIT_BADGE[status]}>{t(status)}</Badge>;
}

/** Le viste dell'Agenda (ADR-075): il giorno, il mese, le visite da riprogrammare. */
export function AgendaTabs({
  routes,
  current,
  toReschedule,
}: {
  readonly routes: TenantRoutes;
  readonly current: 'day' | 'month' | 'reschedule';
  readonly toReschedule: number;
}) {
  const t = useTranslations('care.agenda.tabs');
  const tabs = [
    { key: 'day', href: routes.agenda.day(), label: t('day') },
    { key: 'month', href: routes.agenda.month(), label: t('month') },
    {
      key: 'reschedule',
      href: routes.agenda.toReschedule,
      label: t('reschedule', { count: toReschedule }),
    },
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
            'flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none sm:px-4',
            current === tab.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
            tab.key === 'reschedule' &&
              toReschedule > 0 &&
              current !== tab.key &&
              'text-[oklch(0.45_0.17_27)]',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
