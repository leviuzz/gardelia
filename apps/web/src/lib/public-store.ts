import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { PublicStoreDto } from '@floral/core';
import { BRAND, whatsappLink } from '@floral/domain';
import { publicStoreRoutes } from './routes';

/** Testi della cornice comuni a pagina e prodotto, nella lingua del mercato della fioreria. */
export async function storeShellProps(
  store: Pick<PublicStoreDto, 'slug' | 'name' | 'locale' | 'isDemo' | 'phone'>,
  whatsappText: string,
) {
  const t = await getTranslations({ locale: store.locale, namespace: 'publicStore' });
  return {
    name: store.name,
    homeHref: publicStoreRoutes(store.slug).home,
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
  };
}
