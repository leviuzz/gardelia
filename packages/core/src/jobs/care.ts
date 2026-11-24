/**
 * Lavori giornalieri di Floral Care (ADR-075), dentro la manutenzione:
 *  - allunga le visite dei contratti attivi che coprono meno di 45 giorni, fino a 60 da oggi;
 *  - chiude i contratti il cui ultimo giorno è passato.
 *
 * Le funzioni SQL `SECURITY DEFINER` danno solo gli ID fra le fiorerie (come gli altri lavori). Poi
 * ogni contratto si lavora nella sua transazione, nel contesto della sua fioreria e senza utente
 * (`JobScope`): mai un TenantContext finto. Un errore su un contratto non ferma gli altri.
 * Un cambio di piano non ferma i contratti già firmati: le visite continuano.
 */
import { getDb, withTenantContext } from '@floral/db';
import { CARE_LIMITS } from '@floral/domain';
import { logger } from '../logger';
import { jobWriteScope, loadJobScope } from '../scope';
import { closeEndedCareContractTx, extendCareVisitsTx } from '../services/care-generation';

export interface CareMaintenanceResult {
  /** Contratti con visite nuove. */
  readonly contractsExtended: number;
  readonly visitsScheduled: number;
  /** Visite nate senza posto nel mese ("Por reprogramar"). */
  readonly visitsToReschedule: number;
  readonly contractsEnded: number;
}

interface Candidate {
  readonly tenant_id: string;
  readonly subscription_id: string;
}

export async function runCareMaintenance(): Promise<CareMaintenanceResult> {
  const toExtend = await getDb().$queryRaw<Candidate[]>`
    SELECT tenant_id, subscription_id
    FROM app_care_contracts_to_extend(${CARE_LIMITS.refillDays}::int, ${CARE_LIMITS.jobBatch}::int)`;
  let contractsExtended = 0;
  let visitsScheduled = 0;
  let visitsToReschedule = 0;
  for (const candidate of toExtend) {
    try {
      const result = await withTenantContext(
        getDb(),
        { tenantId: candidate.tenant_id, userId: null },
        async (tx) => {
          const job = await loadJobScope(tx, candidate.tenant_id, 'care.visits.extend');
          if (!job) return null;
          return extendCareVisitsTx(tx, jobWriteScope(job), candidate.subscription_id);
        },
      );
      if (result && result.scheduled + result.toReschedule > 0) {
        contractsExtended += 1;
        visitsScheduled += result.scheduled;
        visitsToReschedule += result.toReschedule;
      }
    } catch (error) {
      logger.error(
        { err: error, subscriptionId: candidate.subscription_id },
        'visite di Floral Care non create',
      );
    }
  }

  const toClose = await getDb().$queryRaw<Candidate[]>`
    SELECT tenant_id, subscription_id
    FROM app_care_contracts_to_close(${CARE_LIMITS.jobBatch}::int)`;
  let contractsEnded = 0;
  for (const candidate of toClose) {
    try {
      const closed = await withTenantContext(
        getDb(),
        { tenantId: candidate.tenant_id, userId: null },
        async (tx) => {
          const job = await loadJobScope(tx, candidate.tenant_id, 'care.contracts.close');
          if (!job) return false;
          return closeEndedCareContractTx(tx, jobWriteScope(job), candidate.subscription_id);
        },
      );
      if (closed) contractsEnded += 1;
    } catch (error) {
      logger.error(
        { err: error, subscriptionId: candidate.subscription_id },
        'contratto di Floral Care non chiuso',
      );
    }
  }
  return { contractsExtended, visitsScheduled, visitsToReschedule, contractsEnded };
}
