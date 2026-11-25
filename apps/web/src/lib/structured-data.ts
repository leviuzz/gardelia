import type { PublicStoreDto, PublicStoreItemDto } from '@floral/core';
import { formatTimeOfDay, isCurrencyCode, minorToDecimalString } from '@floral/domain';

/**
 * Dati strutturati per Google (schema.org, M1-2, ADR-087): la fioreria con indirizzo, telefono e
 * orari; il prodotto con prezzo e disponibilità. Solo dati che la pagina mostra già. Regole pure,
 * provate in `test/structured-data.test.ts`.
 */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const AVAILABILITY: Readonly<Record<PublicStoreItemDto['availability'], string>> = {
  AVAILABLE: 'https://schema.org/InStock',
  LIMITED: 'https://schema.org/LimitedAvailability',
  OUT_OF_STOCK: 'https://schema.org/OutOfStock',
  ON_REQUEST: 'https://schema.org/PreOrder',
};

type StoreFacts = Pick<
  PublicStoreDto,
  'name' | 'description' | 'phone' | 'address' | 'openingHours' | 'currency'
>;

export function storeStructuredData(
  store: StoreFacts,
  links: { readonly url: string; readonly imageUrl: string | null },
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Florist',
    name: store.name,
    url: links.url,
    ...(store.description ? { description: store.description } : {}),
    ...(links.imageUrl ? { image: links.imageUrl } : {}),
    ...(store.phone ? { telephone: store.phone } : {}),
    ...(store.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: store.address.line,
            addressLocality: store.address.city,
            addressRegion: store.address.region,
          },
        }
      : {}),
    ...(store.openingHours
      ? {
          openingHoursSpecification: store.openingHours.flatMap((day) =>
            day.ranges.map((range) => ({
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: `https://schema.org/${DAY_NAMES[day.weekday]}`,
              opens: formatTimeOfDay(range.start),
              closes: formatTimeOfDay(range.end),
            })),
          ),
        }
      : {}),
  };
}

export function productStructuredData(
  item: Pick<PublicStoreItemDto, 'name' | 'description' | 'priceMinor' | 'availability'>,
  store: Pick<PublicStoreDto, 'name' | 'currency'>,
  links: { readonly url: string; readonly imageUrls: readonly string[] },
) {
  // Prezzo in decimali (bordo del sistema): con una valuta sconosciuta niente offerta.
  const offer = isCurrencyCode(store.currency)
    ? {
        offers: {
          '@type': 'Offer',
          url: links.url,
          price: minorToDecimalString(item.priceMinor, store.currency),
          priceCurrency: store.currency,
          availability: AVAILABILITY[item.availability],
          seller: { '@type': 'Florist', name: store.name },
        },
      }
    : {};
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(links.imageUrls.length > 0 ? { image: links.imageUrls } : {}),
    ...offer,
  };
}

/**
 * Il JSON per `<script type="application/ld+json">`: `<`, `>` e `&` (e i separatori di riga) in
 * forma `\u…`, così un nome o una descrizione scritti dalla fioreria non chiudono lo script.
 */
export function serializeStructuredData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
