import type { OrderPaymentStatus, OrderStatus } from '@floral/domain';
import type { BadgeVariant } from '@/components/ui/badge';

export const ORDER_STATUS_BADGE: Record<OrderStatus, BadgeVariant> = {
  DRAFT: 'muted',
  PENDING_ACCEPTANCE: 'warning',
  CONFIRMED: 'info',
  IN_PREPARATION: 'accent',
  READY: 'success',
  OUT_FOR_DELIVERY: 'accent',
  DELIVERED: 'muted',
  PICKED_UP: 'muted',
  CANCELLED: 'danger',
};

export const PAYMENT_STATUS_BADGE: Record<OrderPaymentStatus, BadgeVariant> = {
  UNPAID: 'danger',
  PARTIAL: 'warning',
  PAID: 'success',
};

/** Passi "indietro" (correzioni): si mostrano come pulsanti secondari. */
export const ORDER_BACK_STEPS: Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  IN_PREPARATION: ['CONFIRMED'],
  READY: ['IN_PREPARATION'],
  OUT_FOR_DELIVERY: ['READY'],
};

export function isBackStep(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_BACK_STEPS[from]?.includes(to) ?? false;
}
