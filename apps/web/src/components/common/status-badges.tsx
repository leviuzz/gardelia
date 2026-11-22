import { useTranslations } from 'next-intl';
import type { Availability, QuoteStatus } from '@floral/domain';
import { Badge } from '@/components/ui/badge';
import { AVAILABILITY_BADGE } from '@/lib/catalog-ui';
import { QUOTE_STATUS_BADGE } from '@/lib/quote-ui';
import { cn } from '@/lib/utils';

/** Stato di una cotización con il suo colore (elenco, dettaglio, scheda del cliente). */
export function QuoteStatusBadge({
  status,
  className,
}: {
  readonly status: QuoteStatus;
  readonly className?: string;
}) {
  const t = useTranslations('quotes.statuses');
  return (
    <Badge variant={QUOTE_STATUS_BADGE[status]} className={cn(className)}>
      {t(status)}
    </Badge>
  );
}

/** Disponibilità di un articolo del catalogo con il suo colore. */
export function AvailabilityBadge({ availability }: { readonly availability: Availability }) {
  const t = useTranslations('catalog.availability');
  return <Badge variant={AVAILABILITY_BADGE[availability]}>{t(availability)}</Badge>;
}
