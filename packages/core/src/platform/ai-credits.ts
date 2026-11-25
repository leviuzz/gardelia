/**
 * Pacchetti di crediti (ADR-024): dopo il pagamento (fuori dall'app nel pilota) la piattaforma
 * sblocca X crediti a una fioreria. Solo CLI, operatore SUPER_ADMIN, audit nel tenant. I crediti
 * non scadono. Due tipi: anteprime AI extra (predefinito) e consultas dell'Asistente de plantas
 * che la fioreria dà ai suoi contratti (ADR-085, blocco 6b).
 */
import { getDb, withSystemContext } from '@floral/db';
import { AI_CREDIT_GRANT_LIMITS, AUDIT_ACTIONS } from '@floral/domain';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { PLATFORM_NOTE_MAX_LENGTH } from './plans';

/** I crediti che la piattaforma vende alle fiorerie. */
export type GrantableAiFeature = 'BOUQUET_PREVIEW' | 'PLANT_ASSISTANT';

export interface GrantAiCreditsInput {
  readonly operatorEmail: string;
  readonly tenantSlug: string;
  readonly units: number;
  /** Predefinito: anteprime AI. */
  readonly feature?: GrantableAiFeature;
  /** Riferimento interno del pagamento: mai dati personali. */
  readonly note?: string | null;
}

export interface GrantAiCreditsResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly units: number;
  readonly feature: GrantableAiFeature;
  /** Totale dei crediti di quel tipo concessi a oggi (prima dei consumi). */
  readonly totalGranted: number;
}

export async function grantAiCredits(input: GrantAiCreditsInput): Promise<GrantAiCreditsResult> {
  const units = input.units;
  const feature = input.feature ?? 'BOUQUET_PREVIEW';
  if (feature !== 'BOUQUET_PREVIEW' && feature !== 'PLANT_ASSISTANT') {
    throw new ValidationError({ feature: 'invalid' });
  }
  if (
    !Number.isInteger(units) ||
    units < AI_CREDIT_GRANT_LIMITS.min ||
    units > AI_CREDIT_GRANT_LIMITS.max
  ) {
    throw new ValidationError({ units: 'out_of_range' });
  }
  const note = input.note?.trim() || null;
  if (note && note.length > PLATFORM_NOTE_MAX_LENGTH) {
    throw new ValidationError({ note: 'too_long' });
  }
  const operatorEmail = input.operatorEmail.trim().toLowerCase();
  const tenantSlug = input.tenantSlug.trim().toLowerCase();

  const result = await withSystemContext(
    getDb(),
    { reason: `platform: ${units} crediti ${feature} a ${tenantSlug}` },
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
      const grant = await tx.aiCreditGrant.create({
        data: {
          tenantId: tenant.id,
          feature,
          units,
          note,
          grantedById: operator.id,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: operator.id,
          action:
            feature === 'PLANT_ASSISTANT'
              ? AUDIT_ACTIONS.assistantCreditsGranted
              : AUDIT_ACTIONS.aiCreditsGranted,
          entityType: 'AiCreditGrant',
          entityId: grant.id,
          metadata: { via: 'platform-cli', units, feature, note },
        },
      });
      const total = await tx.aiCreditGrant.aggregate({
        where: { tenantId: tenant.id, feature },
        _sum: { units: true },
      });
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        units,
        feature,
        totalGranted: total._sum.units ?? units,
      };
    },
  );
  logger.info({ tenantId: result.tenantId, units, feature }, 'crediti sbloccati');
  return result;
}
