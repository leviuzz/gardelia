import 'server-only';
import { getTranslations } from 'next-intl/server';
import { hasPermission, type TenantContext } from '@floral/core';
import { BRAND } from '@floral/domain';
import { PlanUpsell } from '@/components/plan-upsell';
import { tenantRoutes } from '@/lib/routes';

/** Invito all'upgrade dell'inventario (piano senza `inventory`): mai una funzione finta. */
export async function InventoryUpsell({ ctx }: { ctx: TenantContext }) {
  const t = await getTranslations();
  const canSeePlan = hasPermission(ctx, 'billing:read');
  return (
    <PlanUpsell
      title={t('inventory.upsell.title', { plan: `${BRAND.productName} ${t('plans.names.PLUS')}` })}
      body={t('inventory.upsell.body')}
      hint={canSeePlan ? t('inventory.upsell.ownerHint') : t('inventory.upsell.teamHint')}
      planHref={canSeePlan ? tenantRoutes(ctx.tenantSlug).settings.plan : undefined}
      planLabel={t('inventory.upsell.seePlan')}
    />
  );
}
