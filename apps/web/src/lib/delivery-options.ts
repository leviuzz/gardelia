/**
 * Opzioni di consegna per i form degli ordini (ADR-055): fasce della fioreria come scelte rapide,
 * giorni di chiusura per l'avviso, costo proposto per i nuovi ordini a domicilio e, se la fioreria
 * ha le fasce di distanza e la posizione della tienda, il calcolo per distanza (ADR-069). Lato server.
 */
import { getTranslations } from 'next-intl/server';
import { getDeliverySettings, type CustomerAddressDto, type TenantContext } from '@floral/core';
import { minorToDecimalString } from '@floral/domain';
import type { SavedAddressOption } from '@/app/app/[tenantSlug]/orders/order-forms';

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
    /** "Calcular por distancia": solo con le fasce e la posizione (ancora valida) della tienda. */
    distance:
      settings.origin && settings.feeTiers.length > 0
        ? {
            origin: settings.origin,
            tiers: settings.feeTiers.map((tier) => ({
              maxMeters: Math.round(tier.maxKm * 1000),
              feeMinor: tier.feeMinor,
            })),
            defaultFeeMinor: settings.defaultFeeMinor,
          }
        : null,
  };
}

/** Indirizzi salvati del cliente come scelte del form, con la posizione per il calcolo. */
export function savedAddressOptions(
  addresses: readonly CustomerAddressDto[],
): SavedAddressOption[] {
  return addresses.map((address) => ({
    id: address.id,
    label: [address.label, address.addressLine1, address.neighborhood].filter(Boolean).join(' · '),
    coordinates: address.coordinates,
  }));
}
