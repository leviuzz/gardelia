import 'server-only';
import { getTranslations } from 'next-intl/server';
import { hasPermission, type TenantContext } from '@floral/core';
import { BRAND } from '@floral/domain';
import { PlanUpsell } from '@/components/plan-upsell';
import { tenantRoutes } from '@/lib/routes';

/** Invito all'upgrade di Floral Care (piano senza `floralCare`): mai una funzione finta. */
export async function CareUpsell({ ctx }: { ctx: TenantContext }) {
  const t = await getTranslations();
  const canSeePlan = hasPermission(ctx, 'billing:read');
  return (
    <PlanUpsell
      title={t('care.upsell.title', { plan: `${BRAND.productName} ${t('plans.names.PLUS')}` })}
      body={t('care.upsell.body')}
      hint={canSeePlan ? t('care.upsell.ownerHint') : t('care.upsell.teamHint')}
      planHref={canSeePlan ? tenantRoutes(ctx.tenantSlug).settings.plan : undefined}
      planLabel={t('care.upsell.seePlan')}
    />
  );
}
