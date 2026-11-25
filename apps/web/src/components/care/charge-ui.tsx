import { useTranslations } from 'next-intl';
import type { CareChargeStatus, CarePaymentStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

const CHARGE_BADGE: Record<CareChargeStatus, BadgeVariant> = {
  PENDING: 'info',
  PARTIAL: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
  NO_BALANCE: 'muted',
  IN_FAVOR: 'accent',
  REFUNDED: 'secondary',
};

/** Stato di un cargo di Floral Care (ADR-082): calcolato in lettura, "Vencido" dopo la scadenza. */
export function ChargeStatusBadge({ status }: { readonly status: CareChargeStatus }) {
  const t = useTranslations('care.chargeStatus');
  return <Badge variant={CHARGE_BADGE[status]}>{t(status)}</Badge>;
}

const COLLECTION_BADGE: Record<CarePaymentStatus, BadgeVariant> = {
  PENDING: 'warning',
  RECORDED: 'success',
  REJECTED: 'danger',
};

/** Stato di un incasso segnato alla visita (blocco 3b): por registrar, registrado, rechazado. */
export function CollectionStatusBadge({ status }: { readonly status: CarePaymentStatus }) {
  const t = useTranslations('care.collection.statuses');
  return <Badge variant={COLLECTION_BADGE[status]}>{t(status)}</Badge>;
}
