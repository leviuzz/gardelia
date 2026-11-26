import 'server-only';
import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  formatTimeOfDay,
  MX_REGIONS,
  type FulfillmentMode,
  type OrderChangeAddress,
  type OrderChangeDiff,
  type OrderChangeSchedule,
} from '@floral/domain';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';

/**
 * I cambi di un ordine online da accettare (M3-2, ADR-088): com'era → com'è, una riga per cambio
 * (consegna o ritiro, giorno e fascia, indirizzo, prodotti, costo di consegna, sconto, totale).
 * Lo vedono il fiorista («Hai cambiato») e chi compra («La florería cambió tu pedido»), ognuno
 * nella sua lingua; i nomi dei prodotti restano come sono scritti nell'ordine.
 */
export async function OrderChangeList({
  diff,
  currency,
  locale,
  testId,
}: {
  readonly diff: OrderChangeDiff;
  readonly currency: string;
  readonly locale: string;
  readonly testId?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'orderChanges' });
  const format = await getFormatter({ locale });
  const fmt = (minor: number) => money(minor, currency, locale);
  const tOrders = await getTranslations({ locale, namespace: 'orders' });
  const modeLabel = (value: FulfillmentMode) => tOrders(`modes.${value}`);

  function schedule(value: OrderChangeSchedule): string {
    if (!value.date) return t('noDate');
    const day = format.dateTime(calendarDate(value.date), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    return value.windowStartMinutes !== null && value.windowEndMinutes !== null
      ? t('dayWindow', {
          day,
          start: formatTimeOfDay(value.windowStartMinutes),
          end: formatTimeOfDay(value.windowEndMinutes),
        })
      : t('dayAllDay', { day });
  }

  function address(value: OrderChangeAddress | null): string {
    if (!value) return t('noAddress');
    const region = value.region
      ? (MX_REGIONS.find((item) => item.code === value.region)?.name ?? value.region)
      : null;
    return [value.line1, value.line2, value.neighborhood, value.city, region, value.postalCode]
      .filter((part) => part && part.trim() !== '')
      .join(', ');
  }

  const rows: {
    readonly key: string;
    readonly label: string;
    readonly before: string | null;
    readonly after: string;
  }[] = [];
  if (diff.fulfillmentMode) {
    rows.push({
      key: 'mode',
      label: t('fulfillment'),
      before: modeLabel(diff.fulfillmentMode.before),
      after: modeLabel(diff.fulfillmentMode.after),
    });
  }
  if (diff.schedule) {
    rows.push({
      key: 'schedule',
      label: t('schedule'),
      before: schedule(diff.schedule.before),
      after: schedule(diff.schedule.after),
    });
  }
  // Passando al ritiro l'indirizzo non serve più: lo dice già la riga della consegna.
  if (diff.address && diff.address.after !== null) {
    rows.push({
      key: 'address',
      label: t('address'),
      before: address(diff.address.before),
      after: address(diff.address.after),
    });
  }
  diff.lines.forEach((line, index) => {
    const key = `line-${index}`;
    if (line.change === 'added' && line.after) {
      rows.push({
        key,
        label: t('added'),
        before: null,
        after: t('lineQuantity', {
          quantity: line.after.quantity,
          name: line.description,
          total: fmt(line.after.lineTotalMinor),
        }),
      });
    } else if (line.change === 'removed' && line.before) {
      rows.push({
        key,
        label: t('removed'),
        before: null,
        after: t('lineRemoved', { quantity: line.before.quantity, name: line.description }),
      });
    } else if (line.before && line.after) {
      rows.push(
        line.before.quantity !== line.after.quantity
          ? {
              key,
              label: line.description,
              before: String(line.before.quantity),
              after: String(line.after.quantity),
            }
          : {
              key,
              label: line.description,
              before: t('unitPrice', { price: fmt(line.before.unitPriceMinor) }),
              after: t('unitPrice', { price: fmt(line.after.unitPriceMinor) }),
            },
      );
    }
  });
  if (diff.deliveryFee) {
    rows.push({
      key: 'fee',
      label: t('deliveryFee'),
      before: fmt(diff.deliveryFee.before),
      after: fmt(diff.deliveryFee.after),
    });
  }
  if (diff.discount) {
    rows.push({
      key: 'discount',
      label: t('discount'),
      before: fmt(diff.discount.before),
      after: fmt(diff.discount.after),
    });
  }
  if (diff.total) {
    rows.push({
      key: 'total',
      label: t('total'),
      before: fmt(diff.total.before),
      after: fmt(diff.total.after),
    });
  }

  return (
    <ul className="space-y-2 text-sm" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.key} className="space-y-0.5">
          <p className="font-medium break-words">{row.label}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground">
            {row.before !== null ? (
              <>
                <span className="break-words line-through decoration-muted-foreground/50">
                  {row.before}
                </span>
                <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t('becomes')}</span>
              </>
            ) : null}
            <span className="font-medium break-words text-foreground">{row.after}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
