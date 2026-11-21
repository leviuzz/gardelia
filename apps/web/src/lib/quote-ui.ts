import type { QuoteStatus } from '@floral/domain';
import type { BadgeVariant } from '@/components/ui/badge';

export const QUOTE_STATUS_BADGE: Record<QuoteStatus, BadgeVariant> = {
  DRAFT: 'muted',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
  CANCELLED: 'muted',
};

/** "AAAA-MM-GG" (data di calendario del tenant) → Date a mezzogiorno UTC per la formattazione. */
export function calendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
}
