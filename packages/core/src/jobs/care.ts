/**
 * Lavori giornalieri di Floral Care (ADR-075, ADR-078), dentro la manutenzione:
 *  - allunga le visite dei contratti attivi che coprono meno di 45 giorni, fino a 60 da oggi;
 *  - chiude i contratti il cui ultimo giorno è passato;
 *  - cancella dallo storage le foto dei contratti finiti da 30 giorni (e quelle tolte i cui file
 *    non si erano cancellati), poi le segna; dopo 7 giorni di errori lo scrive come errore;
 *  - riprova le email dei resoconti rimaste indietro (al massimo 3 tentativi in 3 giorni).
 *
 * Le funzioni SQL `SECURITY DEFINER` danno solo gli ID fra le fiorerie (come gli altri lavori). Poi
 * ogni contratto si lavora nella sua transazione, nel contesto della sua fioreria e senza utente
 * (`JobScope`): mai un TenantContext finto. Un errore su un contratto non ferma gli altri.
 * Un cambio di piano non ferma i contratti già firmati: le visite continuano.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_EMAIL_RETRY,
  CARE_LIMITS,
  CARE_PHOTO_PURGE,
  CARE_PHOTO_RETENTION_DAYS,
  formatSubscriptionNumber,
  isCarePhotoPurgeDue,
  isCarePhotoPurgeOverdue,
  todayInTimeZone,
  type CalendarDate,
} from '@floral/domain';
import { logger } from '../logger';
import { jobWriteScope, loadJobScope, recordJobAudit } from '../scope';
import { closeEndedCareContractTx, extendCareVisitsTx } from '../services/care-generation';
import { deleteCarePhotoFiles } from '../services/care-photos';
import { deliverCareEmail, type CareMailDeps } from '../services/care-visit-work';
import { dateToParts } from '../services/quote-internals';

export interface CareMaintenanceResult {
  /** Contratti con visite nuove. */
  readonly contractsExtended: number;
  readonly visitsScheduled: number;
  /** Visite nate senza posto nel mese ("Por reprogramar"). */
  readonly visitsToReschedule: number;
  readonly contractsEnded: number;
  /** Foto cancellate dallo storage (contratti finiti da 30 giorni o foto tolte). */
  readonly photosDeleted: number;
  /** Resoconti mandati dal lavoro (rimasti indietro dopo "Terminar"). */
  readonly emailsSent: number;
}

interface Candidate {
  readonly tenant_id: string;
  readonly subscription_id: string;
}

/** `mail`: per riprovare le email dei resoconti (null nei test senza email). */
export async function runCareMaintenance(
  mail: CareMailDeps | null = null,
): Promise<CareMaintenanceResult> {
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
  const photos = await purgeCarePhotos();
  const emails = await retryCareEmails(mail);
  return {
    contractsExtended,
    visitsScheduled,
    visitsToReschedule,
    contractsEnded,
    photosDeleted: photos.deleted,
    emailsSent: emails.sent,
  };
}

/** Il giorno da cui contano i 30 giorni: l'ultimo del contratto (o quello in cui si è chiuso). */
function contractEnd(
  contract: { readonly endDate: Date | null; readonly endedAt: Date | null },
  timezone: string,
): CalendarDate | null {
  const end = dateToParts(contract.endDate);
  if (end) return end;
  return contract.endedAt ? todayInTimeZone(timezone, contract.endedAt) : null;
}

export interface CarePhotoPurgeResult {
  readonly deleted: number;
  /** Contratti in cui lo storage non ha risposto: si riprova domani. */
  readonly failed: number;
}

/**
 * Cancella le foto dovute, contratto per contratto: prima i file su R2 (fuori dalle transazioni),
 * poi la riga segnata con `deletedAt` solo per quelli cancellati davvero. Si ferma al primo errore
 * di un contratto (riprova domani) e al tetto di tempo del giro. Un contratto che non è più finito
 * (o non lo è da 30 giorni) si salta: lo ricontrolla qui, nel contesto della fioreria.
 */
export async function purgeCarePhotos(
  options: { readonly deadline?: number } = {},
): Promise<CarePhotoPurgeResult> {
  const deadline = options.deadline ?? Date.now() + CARE_PHOTO_PURGE.budgetMs;
  const due = await getDb().$queryRaw<Candidate[]>`
    SELECT tenant_id, subscription_id
    FROM app_care_photos_to_purge(${CARE_PHOTO_RETENTION_DAYS}::int, ${CARE_PHOTO_PURGE.contractsPerRun}::int)`;
  let deleted = 0;
  let failed = 0;
  for (const candidate of due) {
    if (Date.now() > deadline) break;
    const tenantId = candidate.tenant_id;
    const subscriptionId = candidate.subscription_id;
    try {
      const work = await withTenantContext(getDb(), { tenantId, userId: null }, async (tx) => {
        const job = await loadJobScope(tx, tenantId, 'care.photos.purge');
        if (!job) return null;
        const contract = await tx.customerSubscription.findFirst({
          where: { tenantId, id: subscriptionId },
          select: { number: true, status: true, endDate: true, endedAt: true },
        });
        if (!contract) return null;
        const today = todayInTimeZone(job.timezone);
        const end = contract.status === 'ENDED' ? contractEnd(contract, job.timezone) : null;
        const contractDue = end !== null && isCarePhotoPurgeDue(end, today);
        const photos = await tx.carePhoto.findMany({
          where: {
            tenantId,
            subscriptionId,
            deletedAt: null,
            ...(contractDue ? {} : { removedAt: { not: null } }),
          },
          orderBy: { createdAt: 'asc' },
          take: CARE_PHOTO_PURGE.photosPerContract,
          select: { id: true, storageKey: true, thumbKey: true },
        });
        return {
          number: contract.number,
          photos,
          overdue: end !== null && contractDue && isCarePhotoPurgeOverdue(end, today),
        };
      });
      if (!work || work.photos.length === 0) continue;
      const done: string[] = [];
      for (const photo of work.photos) {
        if (Date.now() > deadline) break;
        if (!(await deleteCarePhotoFiles(photo))) {
          failed += 1;
          break;
        }
        done.push(photo.id);
      }
      if (done.length < work.photos.length && work.overdue) {
        logger.error(
          { subscriptionId, pending: work.photos.length - done.length },
          'foto di Floral Care ancora da cancellare 7 giorni dopo la data',
        );
      }
      if (done.length === 0) continue;
      await withTenantContext(getDb(), { tenantId, userId: null }, async (tx) => {
        const job = await loadJobScope(tx, tenantId, 'care.photos.purge');
        if (!job) return;
        const marked = await tx.carePhoto.updateMany({
          where: { tenantId, id: { in: done }, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (marked.count === 0) return;
        await recordJobAudit(tx, job, {
          action: AUDIT_ACTIONS.carePhotosDeleted,
          entityType: 'CustomerSubscription',
          entityId: subscriptionId,
          metadata: { number: formatSubscriptionNumber(work.number), deleted: marked.count },
        });
      });
      deleted += done.length;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, subscriptionId }, 'foto di Floral Care non cancellate');
    }
  }
  return { deleted, failed };
}

interface DueEmail {
  readonly tenant_id: string;
  readonly email_id: string;
}

/**
 * Le email dei resoconti rimaste indietro: una PENDING mai presa o una FAILED si rimandano; una
 * SENDING ferma da un'ora si chiude come FAILED senza rimandarla (forse è partita) e senza altri
 * tentativi. Il controllo "LIVE e attiva" lo rifà `deliverCareEmail`.
 */
export async function retryCareEmails(
  mail: CareMailDeps | null,
  options: { readonly deadline?: number } = {},
): Promise<{ readonly sent: number; readonly failed: number }> {
  if (!mail) return { sent: 0, failed: 0 };
  const deadline = options.deadline ?? Date.now() + CARE_EMAIL_RETRY.budgetMs;
  const due = await getDb().$queryRaw<DueEmail[]>`
    SELECT tenant_id, email_id FROM app_care_emails_due(${CARE_EMAIL_RETRY.perRun}::int)`;
  let sent = 0;
  let failed = 0;
  for (const { tenant_id: tenantId, email_id: emailId } of due) {
    if (Date.now() > deadline) break;
    try {
      const status = await withTenantContext(getDb(), { tenantId, userId: null }, async (tx) => {
        const job = await loadJobScope(tx, tenantId, 'care.emails.retry');
        if (!job) return null;
        const email = await tx.careEmail.findFirst({
          where: { tenantId, id: emailId },
          select: { status: true },
        });
        if (email?.status !== 'SENDING') return email?.status ?? null;
        const staleBefore = new Date(Date.now() - CARE_EMAIL_RETRY.sendingStaleMinutes * 60_000);
        await tx.careEmail.updateMany({
          where: { tenantId, id: emailId, status: 'SENDING', updatedAt: { lt: staleBefore } },
          data: {
            status: 'FAILED',
            lastError: 'interrupted',
            attempts: CARE_EMAIL_RETRY.maxAttempts,
          },
        });
        return 'SENDING' as const;
      });
      if (status !== 'PENDING' && status !== 'FAILED') continue;
      const outcome = await deliverCareEmail({ tenantId, userId: null }, emailId, mail);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'failed') failed += 1;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, emailId }, 'resoconto di Floral Care non riprovato');
    }
  }
  return { sent, failed };
}
