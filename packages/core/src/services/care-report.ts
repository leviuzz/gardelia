/**
 * Il resoconto di una visita di Floral Care (ADR-076): lo stesso per la pagina della visita, la
 * pagina pubblica del cliente e l'email. Dice cosa si è fatto, come stanno le piante, la nota per
 * il cliente e le foto; mai prezzi, materiali o avvisi interni della squadra.
 *
 * NON esportato da `@floral/core`: lo usano i servizi delle visite e i link pubblici, dentro una
 * transazione già aperta nel contesto della fioreria (con o senza utente).
 */
import type { TransactionClient } from '@floral/db';
import {
  canShareCareVisit,
  carePhotoPurgeDate,
  carePlantTally,
  formatSubscriptionNumber,
  formatTimeOfDay,
  toIsoDate,
  type CarePlantCondition,
  type CarePlantTally,
  type CareServiceOutcome,
} from '@floral/domain';
import { dateToParts } from './quote-internals';

export interface CareReportServiceDto {
  readonly name: string;
  readonly outcome: CareServiceOutcome;
  readonly note: string | null;
}

export interface CareReportPlantDto {
  readonly plantId: string;
  readonly name: string;
  readonly quantity: number;
  readonly condition: CarePlantCondition;
  readonly affected: number | null;
  readonly note: string | null;
  /** Foto visibili legate a questa pianta. */
  readonly photoIds: readonly string[];
}

export interface CareReportPhotoDto {
  readonly id: string;
  readonly plantId: string | null;
}

export interface CareVisitReportDto {
  readonly visitId: string;
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  readonly status: 'DONE' | 'NOT_DONE';
  /** Giorno della visita ("AAAA-MM-GG"). */
  readonly date: string;
  /** Fascia prevista. */
  readonly start: string | null;
  readonly end: string | null;
  /** Inizio e fine veri (da mostrare nel fuso `timezone` della fioreria). */
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly timezone: string;
  /** Chi è venuto: solo il nome. */
  readonly visitedBy: string | null;
  readonly services: readonly CareReportServiceDto[];
  readonly plants: readonly CareReportPlantDto[];
  readonly tally: CarePlantTally;
  /** La nota per il cliente (hecha) o il perché (no realizada). */
  readonly note: string | null;
  readonly photos: readonly CareReportPhotoDto[];
  /** Le foto non ci sono più: il contratto è finito da 30 giorni. */
  readonly photosDeleted: boolean;
  /** Il giorno in cui si cancelleranno le foto, se il contratto ha già l'ultimo giorno. */
  readonly photosDeleteOn: string | null;
}

/** Il nome di battesimo: nel resoconto per il cliente non serve il nome completo di chi lavora. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0] ?? '';
  return first === '' ? null : first;
}

/**
 * Il resoconto della visita, o null se non è (ancora) chiusa. `tenantId` viene dal contesto della
 * transazione: dal membro, dal lavoro o dal link pubblico verificato.
 */
export async function loadCareVisitReportTx(
  tx: TransactionClient,
  tenantId: string,
  visitId: string,
  timezone: string,
): Promise<CareVisitReportDto | null> {
  const visit = await tx.careVisit.findFirst({
    where: { tenantId, id: visitId },
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      startMinutes: true,
      endMinutes: true,
      startedAt: true,
      finishedAt: true,
      startedById: true,
      closedById: true,
      outcomeNote: true,
      subscriptionId: true,
      subscription: {
        select: { number: true, endDate: true, customer: { select: { displayName: true } } },
      },
    },
  });
  if (!visit || !canShareCareVisit(visit.status)) return null;
  const date = dateToParts(visit.scheduledDate);
  if (!date) return null;
  const [services, plants, photos, deletedPhotos, visitor] = await Promise.all([
    tx.careVisitServiceResult.findMany({
      where: { tenantId, visitId },
      orderBy: [{ createdAt: 'asc' }],
      select: { name: true, outcome: true, note: true },
    }),
    tx.careVisitPlantResult.findMany({
      where: { tenantId, visitId },
      orderBy: [{ plant: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
      select: {
        plantId: true,
        plantName: true,
        quantity: true,
        condition: true,
        affected: true,
        note: true,
      },
    }),
    tx.carePhoto.findMany({
      where: { tenantId, visitId, removedAt: null, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, plantId: true },
    }),
    tx.carePhoto.count({ where: { tenantId, visitId, removedAt: null, deletedAt: { not: null } } }),
    visitorName(tx, tenantId, visit.startedById ?? visit.closedById),
  ]);
  const endDate = dateToParts(visit.subscription.endDate);
  return {
    visitId: visit.id,
    subscriptionId: visit.subscriptionId,
    numberLabel: formatSubscriptionNumber(visit.subscription.number),
    customerName: visit.subscription.customer.displayName,
    status: visit.status === 'DONE' ? 'DONE' : 'NOT_DONE',
    date: toIsoDate(date),
    start: visit.startMinutes === null ? null : formatTimeOfDay(visit.startMinutes),
    end: visit.endMinutes === null ? null : formatTimeOfDay(visit.endMinutes),
    startedAt: visit.startedAt,
    finishedAt: visit.finishedAt,
    timezone,
    visitedBy: visitor,
    services,
    plants: plants.map((plant) => ({
      plantId: plant.plantId,
      name: plant.plantName,
      quantity: plant.quantity,
      condition: plant.condition,
      affected: plant.affected,
      note: plant.note,
      photoIds: photos.filter((photo) => photo.plantId === plant.plantId).map((photo) => photo.id),
    })),
    tally: carePlantTally(plants),
    note: visit.outcomeNote,
    photos,
    photosDeleted: deletedPhotos > 0 && photos.length === 0,
    photosDeleteOn: endDate ? toIsoDate(carePhotoPurgeDate(endDate)) : null,
  };
}

async function visitorName(
  tx: TransactionClient,
  tenantId: string,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const member = await tx.membership.findFirst({
    where: { tenantId, userId },
    select: { user: { select: { name: true } } },
  });
  return firstNameOf(member?.user.name);
}
