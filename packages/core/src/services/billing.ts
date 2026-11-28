/**
 * Piano della fioreria ed entitlements [BILL-01].
 *
 *  - Il piano effettivo è quello dell'abbonamento se ancora valido, altrimenti il piano
 *    predefinito (BASIC): una scadenza o una cancellazione non bloccano la fioreria,
 *    tolgono solo le funzioni extra.
 *  - Il merchant legge il proprio abbonamento ma non può modificarlo (RLS): l'assegnazione
 *    avviene solo dalla piattaforma (`@floral/core/platform`).
 *  - `requireEntitlement` va chiamato nei servizi delle funzioni a pagamento, DOPO
 *    `requirePermission`: il ruolo decide chi può, il piano decide se la fioreria ce l'ha.
 *  - Fase di prova (D-29): i piani non limitano le funzioni (`PLAN_FEATURES_ENFORCED`), le
 *    chiamate restano per quando tornano i livelli; le immagini AI incluse restano del piano.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  DEFAULT_PLAN_CODE,
  NO_ENTITLEMENTS,
  PLAN_FEATURES_ENFORCED,
  effectiveEntitlements,
  parseEntitlements,
  subscriptionGrantsAccess,
  type FeatureEntitlement,
  type PlanCode,
  type PlanEntitlements,
  type SubscriptionStatus,
} from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { PlanRequiredError } from '../errors';

export interface TenantSubscriptionDto {
  readonly planCode: PlanCode;
  readonly status: SubscriptionStatus;
  readonly source: 'MANUAL';
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date | null;
  /** false se cancellato o scaduto: si applica il piano predefinito. */
  readonly grantsAccess: boolean;
}

export interface TenantPlanDto {
  /** Piano effettivamente applicato adesso. */
  readonly planCode: PlanCode;
  readonly entitlements: PlanEntitlements;
  /** Fase di prova (D-29): tutte le funzioni incluse, qualunque sia il piano. */
  readonly allFeaturesIncluded: boolean;
  /** Abbonamento registrato (anche se non più valido); null se mai assegnato. */
  readonly subscription: TenantSubscriptionDto | null;
}

async function resolvePlan(
  tx: TransactionClient,
  ctx: Pick<TenantContext, 'tenantId'>,
  now: Date,
): Promise<TenantPlanDto> {
  const subscription = await tx.tenantSubscription.findFirst({
    where: { tenantId: ctx.tenantId },
    include: { plan: { select: { code: true, entitlements: true } } },
  });
  const grantsAccess = subscription ? subscriptionGrantsAccess(subscription, now) : false;
  const subscriptionDto: TenantSubscriptionDto | null = subscription
    ? {
        planCode: subscription.plan.code,
        status: subscription.status,
        source: subscription.source,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        grantsAccess,
      }
    : null;

  if (subscription && grantsAccess) {
    return {
      planCode: subscription.plan.code,
      entitlements: effectiveEntitlements(parseEntitlements(subscription.plan.entitlements)),
      allFeaturesIncluded: !PLAN_FEATURES_ENFORCED,
      subscription: subscriptionDto,
    };
  }
  const fallback = await tx.saasPlan.findUnique({
    where: { code: DEFAULT_PLAN_CODE },
    select: { entitlements: true },
  });
  return {
    planCode: DEFAULT_PLAN_CODE,
    entitlements: effectiveEntitlements(
      fallback ? parseEntitlements(fallback.entitlements) : NO_ENTITLEMENTS,
    ),
    allFeaturesIncluded: !PLAN_FEATURES_ENFORCED,
    subscription: subscriptionDto,
  };
}

/** Piano, stato dell'abbonamento e funzioni incluse (pagina "Plan"). */
export async function getTenantPlan(ctx: TenantContext): Promise<TenantPlanDto> {
  requirePermission(ctx, 'billing:read');
  return withTenantContext(getDb(), ctx, (tx) => resolvePlan(tx, ctx, new Date()));
}

/**
 * Entitlements effettivi della fioreria. Nessun controllo di ruolo: serve a decidere cosa
 * è disponibile (anche per mostrare l'invito all'upgrade), non concede accesso ai dati.
 */
export async function getEntitlements(
  ctx: TenantContext,
  tx?: TransactionClient,
): Promise<PlanEntitlements> {
  const now = new Date();
  if (tx) return (await resolvePlan(tx, ctx, now)).entitlements;
  return withTenantContext(getDb(), ctx, async (inner) => {
    return (await resolvePlan(inner, ctx, now)).entitlements;
  });
}

/**
 * Le funzioni incluse di una fioreria senza una persona (la vetrina pubblica, M5: Floral Care in
 * vetrina solo se il piano lo include). Dentro una transazione già nel contesto della fioreria.
 */
export async function tenantEntitlementsTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<PlanEntitlements> {
  return (await resolvePlan(tx, { tenantId }, new Date())).entitlements;
}

/** Lancia PlanRequiredError se la funzione non è inclusa nel piano effettivo. */
export async function requireEntitlement(
  ctx: TenantContext,
  feature: FeatureEntitlement,
  tx?: TransactionClient,
): Promise<void> {
  const entitlements = await getEntitlements(ctx, tx);
  if (!entitlements[feature]) throw new PlanRequiredError(feature);
}
