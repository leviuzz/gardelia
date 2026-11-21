/**
 * Operazioni di PIATTAFORMA sui piani (fuori dal perimetro di un singolo tenant).
 *
 * Usano il contesto di sistema (bypass RLS): ammesse solo in `src/platform/**` (ESLint) e
 * invocate solo dalla CLI amministrativa (`pnpm platform:assign-plan`), mai dal web
 * (ADR-019). Ogni assegnazione richiede un operatore SUPER_ADMIN e lascia una traccia
 * di audit nel tenant interessato.
 */
import { getDb, withSystemContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  isPlanCode,
  isSubscriptionStatus,
  type PlanCode,
  type SubscriptionStatus,
} from '@floral/domain';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';

export const PLATFORM_NOTE_MAX_LENGTH = 200;

export interface AssignPlanInput {
  /** Email di un utente con ruolo di piattaforma SUPER_ADMIN (responsabile dell'operazione). */
  readonly operatorEmail: string;
  readonly tenantSlug: string;
  readonly planCode: string;
  readonly status: string;
  /** Fine del periodo (esclusa); null = senza scadenza. */
  readonly currentPeriodEnd?: Date | null;
  /** Nota interna (finisce nell'audit): mai dati personali. */
  readonly note?: string | null;
}

export interface AssignPlanResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly planCode: PlanCode;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly previous: { readonly planCode: PlanCode; readonly status: SubscriptionStatus } | null;
}

export async function assignTenantPlan(
  input: AssignPlanInput,
  now: Date = new Date(),
): Promise<AssignPlanResult> {
  const { planCode, status } = input;
  if (!isPlanCode(planCode)) throw new ValidationError({ plan: 'invalid_option' });
  if (!isSubscriptionStatus(status)) throw new ValidationError({ status: 'invalid_option' });
  const periodEnd = input.currentPeriodEnd ?? null;
  if (periodEnd && periodEnd.getTime() <= now.getTime()) {
    throw new ValidationError({ until: 'out_of_range' });
  }
  const note = input.note?.trim() || null;
  if (note && note.length > PLATFORM_NOTE_MAX_LENGTH) {
    throw new ValidationError({ note: 'too_long' });
  }
  const operatorEmail = input.operatorEmail.trim().toLowerCase();
  const tenantSlug = input.tenantSlug.trim().toLowerCase();

  const result = await withSystemContext(
    getDb(),
    { reason: `platform: assegnazione piano ${planCode} a ${tenantSlug}` },
    async (tx) => {
      const operator = await tx.user.findFirst({
        where: { email: operatorEmail, platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!operator) throw new ForbiddenError('platform_admin_required');
      const tenant = await tx.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, slug: true },
      });
      if (!tenant) throw new NotFoundError('Tenant');
      const plan = await tx.saasPlan.findUnique({
        where: { code: planCode },
        select: { id: true },
      });
      if (!plan) throw new NotFoundError('SaasPlan');

      const previous = await tx.tenantSubscription.findUnique({
        where: { tenantId: tenant.id },
        select: { status: true, plan: { select: { code: true } } },
      });
      const data = {
        planId: plan.id,
        status,
        source: 'MANUAL' as const,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      };
      const subscription = await tx.tenantSubscription.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: operator.id,
          action: AUDIT_ACTIONS.subscriptionAssigned,
          entityType: 'TenantSubscription',
          entityId: subscription.id,
          metadata: {
            via: 'platform-cli',
            planCode,
            status,
            until: periodEnd ? periodEnd.toISOString() : null,
            previousPlanCode: previous?.plan.code ?? null,
            previousStatus: previous?.status ?? null,
            note,
          },
        },
      });
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        planCode,
        status,
        currentPeriodEnd: periodEnd,
        previous: previous ? { planCode: previous.plan.code, status: previous.status } : null,
      };
    },
  );
  logger.info(
    { tenantId: result.tenantId, planCode, status, previous: result.previous },
    'piano assegnato dalla piattaforma',
  );
  return result;
}
