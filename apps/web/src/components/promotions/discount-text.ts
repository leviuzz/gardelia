import 'server-only';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import type { PromoDiscountDto } from '@floral/core';
import { formatDiscount, parseIsoDate } from '@floral/domain';
import type { DiscountCardText } from './discount-card';

/**
 * Testi delle schede degli sconti (registro e scheda del cliente) nella lingua di chi guarda:
 * date d'invio nel fuso della fioreria, scadenza come giorno di calendario.
 */
export async function discountTextBuilder(timeZone: string) {
  const t = await getTranslations('promotions.discounts');
  const tOccasions = await getTranslations('customers.occasions');
  const format = await getFormatter();
  const locale = await getLocale();
  const shortDay = (value: Date, zone: string) =>
    format.dateTime(value, { day: 'numeric', month: 'short', timeZone: zone });

  return (discount: PromoDiscountDto): DiscountCardText => {
    const base =
      discount.occasion.type === 'CUSTOM' && discount.occasion.label
        ? discount.occasion.label
        : tOccasions(`types.${discount.occasion.type}`);
    const until = parseIsoDate(discount.validUntil);
    const untilText = until
      ? shortDay(new Date(Date.UTC(until.year, until.month - 1, until.day, 12)), 'UTC')
      : discount.validUntil;
    const usedOn = discount.redeemedAt ? shortDay(new Date(discount.redeemedAt), timeZone) : null;
    return {
      occasion: discount.occasion.personName
        ? `${base} · ${tOccasions('of', { name: discount.occasion.personName })}`
        : base,
      discount: formatDiscount(discount.discount, discount.currency, locale),
      status: t(`statuses.${discount.status}`),
      dates: t('dates', { sent: shortDay(new Date(discount.sentAt), timeZone), until: untilText }),
      used: usedOn
        ? discount.redeemedByName
          ? t('usedBy', { date: usedOn, name: discount.redeemedByName })
          : t('usedOn', { date: usedOn })
        : null,
    };
  };
}
