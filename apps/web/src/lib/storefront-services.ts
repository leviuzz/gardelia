import {
  STOREFRONT_SERVICE_PRESETS,
  isUuid,
  type StorefrontServiceKind,
  type StorefrontServicePreset,
} from '@floral/domain';

/**
 * La chiave di un servizio nell'indirizzo delle Impostazioni (M5): l'ID se il servizio esiste, il
 * tipo del predefinito (`event`, `venue`, `weekly`, `care`) se non è mai stato salvato.
 */
export function storefrontServiceKey(service: {
  readonly id: string | null;
  readonly kind: StorefrontServiceKind;
}): string {
  return service.id ?? service.kind.toLowerCase();
}

/** Il servizio di una chiave dell'indirizzo, o null se non è né un predefinito né un ID. */
export function storefrontServiceTarget(
  key: string,
): { readonly kind: StorefrontServicePreset } | { readonly serviceId: string } | null {
  const preset = STOREFRONT_SERVICE_PRESETS.find((kind) => kind.toLowerCase() === key);
  if (preset) return { kind: preset };
  return isUuid(key) ? { serviceId: key } : null;
}
