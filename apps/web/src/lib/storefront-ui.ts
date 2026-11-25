import 'server-only';
import type { getFormatter, getTranslations } from 'next-intl/server';
import type { PublicStoreDto } from '@floral/core';
import { daysBetween, parseIsoDate, type DeliveryFeeSummary } from '@floral/domain';
import { money } from './format';

type Translator = Awaited<ReturnType<typeof getTranslations<'publicStore'>>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

export type StoreFactKind = 'orders' | 'firstDay' | 'fee' | 'pickup';

/**
 * Le cose utili in alto nella vetrina (M1): ordini online, primo giorno di consegna, costo e
 * ritiro. Testi nella lingua del negozio; il costo a 0 è sempre «por confirmar», mai «gratis».
 */
export function storeFacts(
  store: PublicStoreDto,
  t: Translator,
  format: Formatter,
): { readonly kind: StoreFactKind; readonly label: string }[] {
  const facts: { kind: StoreFactKind; label: string }[] = [];
  const canOrder = store.ordersEnabled && store.delivery.firstDate !== null;
  if (canOrder) facts.push({ kind: 'orders', label: t('factOrders') });
  const firstDay = firstDayLabel(store.delivery, t, format);
  if (canOrder && firstDay) facts.push({ kind: 'firstDay', label: firstDay });
  const fmt = (minor: number) => money(minor, store.currency, store.locale);
  facts.push({ kind: 'fee', label: feeSummaryLabel(store.delivery.feeSummary, fmt, t) });
  if (store.address) facts.push({ kind: 'pickup', label: t('factPickup') });
  return facts;
}

/** Il costo di consegna in una riga (testata della vetrina, schede della ricerca). */
export function feeSummaryLabel(
  fee: DeliveryFeeSummary,
  fmt: (minor: number) => string,
  t: Translator,
): string {
  return fee.kind === 'fixed'
    ? t('factFeeFixed', { fee: fmt(fee.feeMinor) })
    : fee.kind === 'range'
      ? fee.minMinor > 0
        ? t('factFeeRange', { min: fmt(fee.minMinor), max: fmt(fee.maxMinor) })
        : t('factFeeUpTo', { max: fmt(fee.maxMinor) })
      : t('factFeeConfirm');
}

/** «Entrega desde hoy / mañana / el jueves 27 de noviembre», o null senza un giorno. */
export function firstDayLabel(
  delivery: { readonly firstDate: string | null; readonly today: string },
  t: Translator,
  format: Formatter,
) {
  const first = parseIsoDate(delivery.firstDate);
  const today = parseIsoDate(delivery.today);
  if (!first || !today) return null;
  const days = daysBetween(today, first);
  if (days <= 0) return t('factFirstToday');
  if (days === 1) return t('factFirstTomorrow');
  return t('factFirstDate', {
    date: format.dateTime(new Date(Date.UTC(first.year, first.month - 1, first.day, 12)), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }),
  });
}

/** Le politiche scritte dalla fioreria, nell'ordine della pagina; vuoto se non ce ne sono. */
export function storePolicies(
  store: Pick<PublicStoreDto, 'policies'>,
  t: Translator,
): { readonly title: string; readonly text: string }[] {
  return [
    { title: t('policyChanges'), text: store.policies.changes },
    { title: t('policyCancellations'), text: store.policies.cancellations },
    { title: t('policySubstitutions'), text: store.policies.substitutions },
  ].filter((policy): policy is { title: string; text: string } => policy.text !== null);
}
