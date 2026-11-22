import { TicketPercent } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PromoDiscountDto } from '@floral/core';
import type { PromoDiscountStatus } from '@floral/domain';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

const STATUS_BADGE: Readonly<Record<PromoDiscountStatus, BadgeVariant>> = {
  VALID: 'success',
  USED: 'muted',
  EXPIRED: 'warning',
};

/** Testi già pronti nella lingua di chi guarda (li calcola la pagina). */
export interface DiscountCardText {
  readonly occasion: string;
  readonly discount: string;
  readonly status: string;
  /** "Enviado el 7 dic · vale hasta el 14 dic". */
  readonly dates: string;
  /** "Usado el 10 dic por Lucía", o null. */
  readonly used: string | null;
}

/**
 * Uno sconto della promo (ADR-048): codice ben leggibile, stato, cliente, data e sconto; le azioni
 * ("Marcar como usado", "Deshacer") le passa la pagina secondo i permessi.
 */
export function DiscountCard({
  discount,
  text,
  customerHref,
  actions,
}: {
  discount: PromoDiscountDto;
  text: DiscountCardText;
  /** Link al cliente (registro degli sconti); null nella scheda del cliente stesso. */
  customerHref: string | null;
  actions: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
      <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground sm:flex">
        <TicketPercent className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold tracking-widest">{discount.code}</span>
          <Badge variant={STATUS_BADGE[discount.status]}>{text.status}</Badge>
        </div>
        <p className="text-sm break-words">
          {customerHref ? (
            <Link href={customerHref} className="font-medium hover:underline">
              {discount.customerName}
            </Link>
          ) : null}
          {customerHref ? ' · ' : null}
          {text.occasion} · <span className="font-medium">{text.discount}</span>
        </p>
        <p className="text-xs text-muted-foreground">{text.dates}</p>
        {text.used ? (
          <p className="text-xs break-words text-muted-foreground">
            {text.used}
            {discount.note ? ` — ${discount.note}` : null}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
    </article>
  );
}
