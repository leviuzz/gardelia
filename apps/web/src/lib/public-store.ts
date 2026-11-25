import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import {
  getPublicStore,
  getPublicStoreItem,
  getPublicStorefront,
  type PublicStoreDto,
} from '@floral/core';
import {
  BRAND,
  STOREFRONT_CART_COOKIE,
  parseCart,
  parseStorefrontQuery,
  whatsappLink,
  type CartLine,
} from '@floral/domain';
import { publicStoreLinks, type StoreLinks } from './routes';

/**
 * Testi della cornice comuni a pagina e prodotto, nella lingua del mercato della fioreria. I link
 * sono quelli pubblici, o quelli dell'anteprima della fioreria (M1-2).
 */
export async function storeShellProps(
  store: Pick<PublicStoreDto, 'slug' | 'name' | 'locale' | 'isDemo' | 'phone' | 'logoId'>,
  whatsappText: string,
  links: StoreLinks = publicStoreLinks(store.slug),
) {
  const t = await getTranslations({ locale: store.locale, namespace: 'publicStore' });
  return {
    name: store.name,
    logoSrc: store.logoId ? links.image('LOGO', store.logoId) : null,
    homeHref: links.home,
    demoNotice: store.isDemo ? t('demoNotice') : null,
    contact: store.phone
      ? {
          whatsappHref: whatsappLink(store.phone, whatsappText),
          whatsappLabel: t('whatsapp'),
          callHref: `tel:${store.phone}`,
          callLabel: t('call'),
        }
      : null,
    footer: t('footer', { brand: BRAND.productName }),
    locale: store.locale,
  };
}

/**
 * Il carrello di chi guarda (cookie della fioreria, M1): solo ID e quantità. Lo legge il server
 * per riempire la barra «Tu pedido» e il modulo d'ordine; prezzi e disponibilità li rifà il core.
 */
export async function readCartCookie(): Promise<CartLine[]> {
  return parseCart((await cookies()).get(STOREFRONT_CART_COOKIE)?.value);
}

/**
 * Le letture della pagina pubblica, una per richiesta: `generateMetadata` e la pagina chiedono gli
 * stessi dati e `cache` li legge una volta sola. La vetrina usa una chiave testuale (scheda,
 * ricerca, ordine, pagina) perché `cache` confronta gli argomenti per identità.
 */
export const loadPublicStore = cache((slug: string) => getPublicStore(slug));

export const loadStorefront = cache(async (slug: string, queryKey: string) =>
  getPublicStorefront(slug, JSON.parse(queryKey) as unknown, { cart: await readCartCookie() }),
);

export function storefrontQueryKey(searchParams: unknown): string {
  return JSON.stringify(parseStorefrontQuery(searchParams));
}

export const loadStoreItem = cache(async (slug: string, itemId: string) =>
  getPublicStoreItem(slug, itemId, { cart: await readCartCookie() }),
);
