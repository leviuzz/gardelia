/**
 * Funzioni interne di Floral Care (ADR-074) condivise da offerta, contratti, visite e lavori. NON
 * esportate da `@floral/core`: lavorano dentro una transazione già aperta nel contesto della
 * fioreria e presuppongono permessi già verificati.
 */
import type { CareSettings, Prisma, TransactionClient } from '@floral/db';
import {
  careTravelForDistance,
  compareDates,
  freshCoordinates,
  priceCareVisit,
  roundedDistanceKm,
  sortFeeTiers,
  toIsoDate,
  type CalendarDate,
  type CareTravelQuote,
  type CareVisitPrice,
  type Coordinates,
  type DeliveryFeeTier,
  type PlantSize,
} from '@floral/domain';
import { ConflictError, ValidationError } from '../errors';
import { dateToParts, partsToDate } from './quote-internals';

export function laterDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareDates(a, b) >= 0 ? a : b;
}

export function earlierDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareDates(a, b) <= 0 ? a : b;
}

/** Una colonna `@db.Date` obbligatoria come data del calendario. */
export function requiredParts(date: Date): CalendarDate {
  const parts = dateToParts(date);
  if (!parts) throw new Error('Data mancante');
  return parts;
}

export function isoOf(date: Date | null): string | null {
  const parts = dateToParts(date);
  return parts ? toIsoDate(parts) : null;
}

export function dbDate(date: CalendarDate): Date {
  return partsToDate(date);
}

/** "Av. Madero 120, Centro". */
export function addressLineOf(address: {
  readonly addressLine1: string;
  readonly neighborhood: string | null;
}): string {
  return [address.addressLine1, address.neighborhood].filter(Boolean).join(', ');
}

export async function loadCareSettings(
  tx: TransactionClient,
  tenantId: string,
): Promise<CareSettings | null> {
  return tx.careSettings.findUnique({ where: { tenantId } });
}

/** L'offerta salvata, o `care_not_configured`: senza tariffe non si fa nulla. */
export async function requireCareSettings(
  tx: TransactionClient,
  tenantId: string,
): Promise<CareSettings> {
  const settings = await loadCareSettings(tx, tenantId);
  if (!settings) throw new ConflictError('care_not_configured');
  return settings;
}

export function careFeesOf(settings: {
  readonly careFeeSmallMinor: number;
  readonly careFeeMediumMinor: number;
  readonly careFeeLargeMinor: number;
}): Record<PlantSize, number> {
  return {
    SMALL: settings.careFeeSmallMinor,
    MEDIUM: settings.careFeeMediumMinor,
    LARGE: settings.careFeeLargeMinor,
  };
}

export interface ShopPlace {
  /** Coordinate della tienda principale ancora valide (ADR-059), o null. */
  readonly origin: Coordinates | null;
  /** Raggio di consegna della tienda: il valore proposto per Floral Care. */
  readonly deliveryRadiusKm: number | null;
}

export async function loadShopPlace(tx: TransactionClient, tenantId: string): Promise<ShopPlace> {
  const location = await tx.location.findFirst({
    where: { tenantId, isPrimary: true },
    select: { latitude: true, longitude: true, coordinatesAt: true, deliveryRadiusKm: true },
  });
  return {
    origin: location ? freshCoordinates(location, new Date()) : null,
    deliveryRadiusKm: location?.deliveryRadiusKm ?? null,
  };
}

export async function loadCareTravelTiers(
  tx: TransactionClient,
  tenantId: string,
): Promise<DeliveryFeeTier[]> {
  const tiers = await tx.careTravelTier.findMany({
    where: { tenantId },
    select: { maxMeters: true, feeMinor: true },
  });
  return sortFeeTiers(tiers);
}

/**
 * Distanza in linea retta fra la tienda e la sede (km, un decimale), se le due posizioni sono
 * ancora valide; altrimenti quella già salvata nel contratto (le coordinate scadono dopo 30 giorni).
 */
export async function measureSiteDistance(
  tx: TransactionClient,
  tenantId: string,
  input: { readonly customerAddressId: string; readonly savedMeters: number | null },
): Promise<number | null> {
  const [place, address] = await Promise.all([
    loadShopPlace(tx, tenantId),
    tx.customerAddress.findFirst({
      where: { tenantId, id: input.customerAddressId },
      select: { latitude: true, longitude: true, coordinatesAt: true },
    }),
  ]);
  const site = address ? freshCoordinates(address, new Date()) : null;
  if (place.origin && site) return roundedDistanceKm(place.origin, site);
  return input.savedMeters === null ? null : Math.round(input.savedMeters / 100) / 10;
}

export interface ContractPricing {
  readonly price: CareVisitPrice;
  readonly travel: CareTravelQuote;
  /** Distanza misurata o salvata, in metri. */
  readonly distanceMeters: number | null;
}

/**
 * Prezzo di una visita del contratto con l'offerta di OGGI: tariffa, care per misura delle piante
 * attive, sovrapprezzo per la distanza e prezzi attuali dei servizi extra scelti. Lo calcola solo il
 * server; si salva alla conferma e quando il fiorista aggiorna il prezzo.
 */
export async function priceContractNow(
  tx: TransactionClient,
  tenantId: string,
  subscription: {
    readonly id: string;
    readonly customerAddressId: string | null;
    readonly distanceMeters: number | null;
  },
  settings: CareSettings,
): Promise<ContractPricing> {
  const [plants, services, tiers] = await Promise.all([
    tx.carePlant.findMany({
      where: { tenantId, subscriptionId: subscription.id, status: 'ACTIVE' },
      select: { size: true, quantity: true },
    }),
    tx.customerSubscriptionService.findMany({
      where: { tenantId, subscriptionId: subscription.id },
      select: { service: { select: { pricing: true, unit: true, priceMinor: true } } },
    }),
    loadCareTravelTiers(tx, tenantId),
  ]);
  const distanceKm = subscription.customerAddressId
    ? await measureSiteDistance(tx, tenantId, {
        customerAddressId: subscription.customerAddressId,
        savedMeters: subscription.distanceMeters,
      })
    : null;
  const travel = careTravelForDistance({
    tiers,
    maxDistanceKm: settings.maxDistanceKm,
    distanceKm,
  });
  const result = priceCareVisit({
    visitFeeMinor: settings.visitFeeMinor,
    // Fuori dal raggio vale il sovrapprezzo dell'ultima fascia (se il fiorista va lo stesso).
    travelSurchargeMinor:
      travel.kind === 'in_range'
        ? travel.surchargeMinor
        : travel.kind === 'out_of_range'
          ? (tiers.at(-1)?.feeMinor ?? 0)
          : 0,
    careFees: careFeesOf(settings),
    plants,
    extras: services
      .filter((link) => link.service.pricing === 'EXTRA')
      .map((link) => ({ unit: link.service.unit, priceMinor: link.service.priceMinor })),
  });
  if (!result.ok) throw new ValidationError({ price: result.error });
  return {
    price: result.price,
    travel,
    distanceMeters: distanceKm === null ? null : Math.round(distanceKm * 1000),
  };
}

/**
 * Le visite ancora da fare di un contratto da un giorno in poi: programmate da quel giorno, o "Por
 * reprogramar" nate da quel giorno in poi. Sono quelle che un cambio tocca (casella dell'avviso).
 */
export function openVisitsFrom(
  tenantId: string,
  subscriptionId: string,
  from: CalendarDate,
): Prisma.CareVisitWhereInput {
  return {
    tenantId,
    subscriptionId,
    OR: [
      { status: 'SCHEDULED', scheduledDate: { gte: dbDate(from) } },
      { status: 'TO_RESCHEDULE', originalDate: { gte: dbDate(from) } },
    ],
  };
}

/** Blocca il contratto fino alla fine della transazione (prima delle fasce e delle visite). */
export async function lockSubscription(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CustomerSubscription"
    WHERE "id" = ${subscriptionId}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`;
  return rows.length > 0;
}
