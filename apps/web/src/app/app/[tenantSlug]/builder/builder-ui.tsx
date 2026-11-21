import 'server-only';
import { getTranslations } from 'next-intl/server';
import { hasPermission, type BuilderCatalogDto, type TenantContext } from '@floral/core';
import { BRAND } from '@floral/domain';
import { PlanUpsell } from '@/components/plan-upsell';
import type { BuilderOptionView } from './bouquet-editor';

/** Invito all'upgrade del Builder (piano senza `bouquetBuilder`). */
export async function BuilderUpsell({ ctx }: { ctx: TenantContext }) {
  const t = await getTranslations();
  const canSeePlan = hasPermission(ctx, 'billing:read');
  return (
    <PlanUpsell
      title={t('builder.upsell.title', { plan: `${BRAND.productName} ${t('plans.names.PLUS')}` })}
      body={t('builder.upsell.body')}
      hint={canSeePlan ? t('builder.upsell.ownerHint') : t('builder.upsell.teamHint')}
      planHref={canSeePlan ? `/app/${ctx.tenantSlug}/settings/plan` : undefined}
      planLabel={t('builder.upsell.seePlan')}
    />
  );
}

/**
 * Opzioni dell'editor con etichette già tradotte (nome · varietà, unità di vendita, colori)
 * e la miniatura della foto di ogni colore, servita dalla route privata del catalogo.
 */
export async function builderOptions(
  catalog: BuilderCatalogDto,
  tenantSlug: string,
): Promise<BuilderOptionView[]> {
  const t = await getTranslations('catalog');
  const photoSrc = (photoId: string) => `/app/${tenantSlug}/catalog/photos/${photoId}?size=thumb`;
  return catalog.options.map((option) => ({
    id: option.id,
    name: option.variety ? `${option.name} · ${option.variety}` : option.name,
    role: option.role,
    priceMinor: option.priceMinor,
    costMinor: option.costMinor,
    availability: option.availability,
    unitLabel: t(`units.${option.saleUnit}`),
    colors: option.colors.map((color) => {
      const photo = option.colorPhotos.find((entry) => entry.color === color);
      return {
        value: color,
        label: t(`colors.${color}`),
        photoSrc: photo ? photoSrc(photo.photoId) : null,
      };
    }),
  }));
}
