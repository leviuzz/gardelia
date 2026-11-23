/**
 * Opzioni di consegna per i form degli ordini (ADR-055): fasce della fioreria come scelte rapide,
 * giorni di chiusura per l'avviso e costo proposto per i nuovi ordini a domicilio. Lato server.
 */
import { getTranslations } from 'next-intl/server';
import { getDeliverySettings, type TenantContext } from '@floral/core';
import { minorToDecimalString } from '@floral/domain';

export async function deliveryFormOptions(ctx: TenantContext) {
  const settings = await getDeliverySettings(ctx);
  const t = await getTranslations('orders');
  return {
    windows: settings.windows.map((window) => ({
      start: window.start,
      end: window.end,
      label: t('window', { start: window.start, end: window.end }),
    })),
    closedWeekdays: settings.closedWeekdays,
    /** Per i nuovi ordini; vuoto se la fioreria non ne ha uno. */
    defaultFee:
      settings.defaultFeeMinor > 0
        ? minorToDecimalString(settings.defaultFeeMinor, ctx.currency)
        : '',
  };
}
