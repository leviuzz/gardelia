/**
 * Floral Care, pagina del cliente (blocco 5a, ADR-084) — lato persona: "Mi Floral Care".
 *
 *  - La persona arriva solo dalla sessione (`BuyerContext`, ADR-064). Le letture passano da
 *    `withPortalContext`: il database apre il contratto solo se c'è l'accesso, e in quella modalità
 *    le tabelle della fioreria danno solo le righe di quel contratto. Un contratto che non è suo
 *    risponde 404 come uno che non esiste (nessuna sonda fra fiorerie, come in ADR-064).
 *  - Senza "Puede ver precios y cobros" i prezzi non escono dal servizio e i cargos nemmeno dal
 *    database.
 *  - "Cambiar fecha" (DECISO): solo nello stesso mese, fra le fasce libere, dopo il preavviso del
 *    contratto. Scrive nel contesto della fioreria (i posti si contano su tutte le visite) con la
 *    guardia del portale sulle visite; ordine dei blocchi contratto → fasce → visita, come chi
 *    sposta dalla fioreria. Alla fioreria arriva un'email (proprietari e gerenti, fioreria LIVE).
 *  - L'invito si accetta solo con la stessa email: nasce l'accesso, e il conto cliente si apre
 *    (così chi non ha fiorerie arriva a "Mi cuenta").
 */
import {
  getDb,
  isRlsViolation,
  withPortalContext,
  withPortalWriteContext,
  withTenantContext,
  withUserContext,
  type PortalEntry,
  type TransactionClient,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_MESSAGE_LIMITS,
  CARE_PORTAL_LIMITS,
  CARE_VISIT_HOLDING_STATUSES,
  addDays,
  careCustomerChangeProblem,
  careCustomerChangeUntil,
  careCustomerEarliestStart,
  careCustomerTargetProblem,
  careMessageDayStart,
  careMessagePages,
  careMessageProblem,
  careMessageSchema,
  careMessagesOpen,
  careEmailsAllowed,
  careMonthBounds,
  carePhotoPurgeDate,
  carePortalInviteStatus,
  carePortalMoveSchema,
  careVisitStartAt,
  compareDates,
  dayOfWeek,
  formatSubscriptionNumber,
  formatTimeOfDay,
  getMarket,
  isUuid,
  newId,
  normalizeEmail,
  resolveLocale,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareChargeStatus,
  type CareCustomerChangeProblem,
  type CareFrequency,
  type CarePortalInviteStatus,
  type CarePortalScope,
  type CareServicePricing,
  type CareServiceUnit,
  type CareVisitStatus,
  type CustomerSubscriptionStatus,
  type DeadPlantPolicy,
  type MarketCountry,
  type MissedVisitPolicy,
  type PlantLight,
  type PlantSize,
} from '@floral/domain';
import { careVisitMovedByCustomerEmail } from '../care-email';
import type { RequestMeta } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Mailer } from '../mailer';
import {
  deleteUnusedFiles,
  readStoredImage,
  storeFilesThenCommit,
  type StoredImage,
} from '../media/stored-files';
import { recordPortalAudit } from '../scope';
import { openBuyerAccount, type BuyerContext } from './buyer-account';
import { openSlotBook } from './care-booking';
import {
  careChargeSummarySelect,
  toCareChargeSummary,
  type CareChargeLineDto,
  type CareChargeSummaryDto,
} from './care-charges';
import {
  dbDate,
  earlierDate,
  isoOf,
  laterDate,
  lockSubscription,
  requiredParts,
} from './care-internals';
import { readCarePortalInviteToken } from './care-portal';
import { shopManagerEmailsTx } from './care-message-internals';
import { careMessageSelect, prepareCareMessagePhoto, toCareMessageDto } from './care-messages';
import { loadCareVisitReportTx, type CareVisitReportDto } from './care-report';
import { lockCareVisitTx } from './care-visit-internals';
import { dateToParts } from './quote-internals';

function assertBuyer(buyer: BuyerContext): void {
  if (!isUuid(buyer.userId)) throw new TypeError('BuyerContext senza un utente valido');
}

// -----------------------------------------------------------------------------
// Elenco
// -----------------------------------------------------------------------------

export interface MyCareContractListItemDto {
  readonly subscriptionId: string;
  readonly shopName: string;
  readonly numberLabel: string;
  readonly status: CustomerSubscriptionStatus;
  /** Finito: si legge ancora fino a quando si cancellano le foto. */
  readonly readOnly: boolean;
  readonly canSeeMoney: boolean;
  readonly customerName: string;
  readonly siteLabel: string | null;
  readonly siteLine: string | null;
  readonly timezone: string;
  readonly endDate: string | null;
  readonly nextVisit: { readonly date: string; readonly start: string | null } | null;
  /** Quanto c'è da pagare (solo con i soldi). */
  readonly dueMinor: number | null;
  readonly currency: string;
  /** Messaggi della fioreria dopo l'ultima lettura della persona (ADR-084, blocco 5b). */
  readonly unreadMessages: number;
}

interface ContractRow {
  tenant_id: string;
  subscription_id: string;
  shop_slug: string;
  shop_name: string;
  shop_timezone: string;
  number: number;
  status: CustomerSubscriptionStatus;
  read_only: boolean;
  can_see_money: boolean;
  customer_name: string;
  site_label: string | null;
  site_line: string | null;
  end_date: Date | null;
  next_visit_date: Date | null;
  next_visit_start: number | null;
  due_minor: number | null;
  currency: string;
  unread_count: number;
}

async function contractRows(buyer: BuyerContext): Promise<ContractRow[]> {
  return withUserContext(
    getDb(),
    buyer.userId,
    (tx) => tx.$queryRaw<ContractRow[]>`SELECT * FROM app_buyer_care_contracts()`,
  );
}

/** I contratti che la persona vede, fra tutte le fiorerie (aperti prima). */
export async function listMyCareContracts(
  buyer: BuyerContext,
): Promise<readonly MyCareContractListItemDto[]> {
  assertBuyer(buyer);
  const rows = await contractRows(buyer);
  return rows.map((row) => ({
    subscriptionId: row.subscription_id,
    shopName: row.shop_name,
    numberLabel: formatSubscriptionNumber(row.number),
    status: row.status,
    readOnly: row.read_only,
    canSeeMoney: row.can_see_money,
    customerName: row.customer_name,
    siteLabel: row.site_label,
    siteLine: row.site_line,
    timezone: row.shop_timezone,
    endDate: isoOf(row.end_date),
    nextVisit: row.next_visit_date
      ? {
          date: isoOf(row.next_visit_date) ?? '',
          start: row.next_visit_start === null ? null : formatTimeOfDay(row.next_visit_start),
        }
      : null,
    dueMinor: row.can_see_money ? (row.due_minor ?? 0) : null,
    currency: row.currency.trim(),
    unreadMessages: row.unread_count,
  }));
}

/** La fioreria del contratto, per il contesto di scrittura: solo dalle righe della persona. */
async function contractTenant(buyer: BuyerContext, subscriptionId: string): Promise<string> {
  const row = (await contractRows(buyer)).find((item) => item.subscription_id === subscriptionId);
  if (!row) throw new NotFoundError('CustomerSubscription');
  return row.tenant_id;
}

// -----------------------------------------------------------------------------
// Il contratto
// -----------------------------------------------------------------------------

export interface MyCareVisitDto {
  readonly id: string;
  readonly status: CareVisitStatus;
  /** null = "Por reprogramar": la fioreria sceglierà la data. */
  readonly date: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly isExtra: boolean;
  /** "Cambiar fecha" si può adesso. */
  readonly canChange: boolean;
  /** Fino a quando si può cambiare (preavviso del contratto). */
  readonly changeUntil: Date | null;
  readonly changedByCustomer: boolean;
  /** Fatta o "No se pudo": c'è il resoconto. */
  readonly hasReport: boolean;
}

export interface MyCareContractDto {
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly status: CustomerSubscriptionStatus;
  readonly readOnly: boolean;
  readonly canSeeMoney: boolean;
  readonly shop: {
    readonly name: string;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
    readonly timezone: string;
    readonly country: MarketCountry;
  };
  readonly customerName: string;
  readonly site: {
    readonly label: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly neighborhood: string | null;
    readonly city: string;
  } | null;
  readonly frequency: CareFrequency | null;
  readonly slots: readonly {
    readonly weekday: number;
    readonly start: string;
    readonly end: string;
  }[];
  readonly startDate: string;
  readonly endDate: string | null;
  readonly rules: {
    readonly minNoticeHours: number;
    readonly lateCancelHours: number | null;
    readonly missedVisitPolicy: MissedVisitPolicy | null;
    readonly deadPlantPolicy: DeadPlantPolicy | null;
  };
  /** Solo con i soldi. */
  readonly price: {
    readonly perVisitMinor: number;
    readonly oneTimeMinor: number;
    readonly currency: string;
  } | null;
  readonly services: readonly {
    readonly name: string;
    readonly pricing: CareServicePricing;
    readonly unit: CareServiceUnit;
    /** null senza i soldi. */
    readonly priceMinor: number | null;
  }[];
  readonly plants: readonly {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly size: PlantSize;
    readonly location: string | null;
    readonly light: PlantLight | null;
    readonly watering: string | null;
    readonly instructions: string | null;
  }[];
  readonly upcoming: readonly MyCareVisitDto[];
  readonly toReschedule: number;
  readonly past: readonly MyCareVisitDto[];
  /** Solo con i soldi. */
  readonly charges: {
    readonly items: readonly CareChargeSummaryDto[];
    readonly dueMinor: number;
    readonly overdueMinor: number;
    readonly currency: string;
  } | null;
  readonly termsText: string | null;
  /** Contratto finito: il giorno in cui si cancellano le foto (e si chiude la pagina). */
  readonly photosDeleteOn: string | null;
}

const UPCOMING_LIMIT = 12;
const PAST_LIMIT = 24;
const CHARGES_LIMIT = 24;

interface VisitRow {
  readonly id: string;
  readonly status: CareVisitStatus;
  readonly scheduledDate: Date | null;
  readonly startMinutes: number | null;
  readonly endMinutes: number | null;
  readonly isExtra: boolean;
  readonly slotId: string | null;
  readonly customerMovedAt: Date | null;
}

const visitSelect = {
  id: true,
  status: true,
  scheduledDate: true,
  startMinutes: true,
  endMinutes: true,
  isExtra: true,
  slotId: true,
  customerMovedAt: true,
} as const;

function toMyVisit(
  row: VisitRow,
  contract: { readonly status: CustomerSubscriptionStatus; readonly noticeHours: number },
  timeZone: string,
  now: Date,
): MyCareVisitDto {
  const date = dateToParts(row.scheduledDate);
  const problem = careCustomerChangeProblem({
    contractStatus: contract.status,
    visit: { ...row, scheduledDate: date },
    noticeHours: contract.noticeHours,
    timeZone,
    now,
  });
  const start = careVisitStartAt(date, row.startMinutes, timeZone);
  return {
    id: row.id,
    status: row.status,
    date: date ? toIsoDate(date) : null,
    start: row.startMinutes === null ? null : formatTimeOfDay(row.startMinutes),
    end: row.endMinutes === null ? null : formatTimeOfDay(row.endMinutes),
    isExtra: row.isExtra,
    canChange: problem === null,
    changeUntil:
      row.status === 'SCHEDULED' && !row.isExtra
        ? careCustomerChangeUntil(start, contract.noticeHours)
        : null,
    changedByCustomer: row.customerMovedAt !== null,
    hasReport: row.status === 'DONE' || row.status === 'NOT_DONE',
  };
}

function noticeOf(value: number | null): number {
  return value ?? CARE_PORTAL_LIMITS.defaultNoticeHours;
}

/**
 * Apre il contratto della persona in modalità portale (null senza accesso). Interno al core: lo usa
 * anche l'Asistente de plantas del cliente (`my-plant-assistant.ts`).
 */
export function openPortal<T>(
  buyer: BuyerContext,
  subscriptionId: string,
  fn: (tx: TransactionClient, entry: PortalEntry) => Promise<T>,
): Promise<T | null> {
  assertBuyer(buyer);
  if (!isUuid(subscriptionId)) return Promise.resolve(null);
  return withPortalContext(getDb(), { userId: buyer.userId, subscriptionId }, fn);
}

/** La pagina del contratto: cosa comprende, le visite, le piante, i cargos (con i soldi). */
export async function getMyCareContract(
  buyer: BuyerContext,
  subscriptionId: string,
): Promise<MyCareContractDto> {
  const now = new Date();
  const found = await openPortal(buyer, subscriptionId, async (tx, entry) => {
    const tenantId = entry.tenantId;
    const today = todayInTimeZone(entry.shop.timezone, now);
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId, id: subscriptionId },
      select: {
        number: true,
        status: true,
        frequency: true,
        startDate: true,
        endDate: true,
        currency: true,
        perVisitMinor: true,
        oneTimeMinor: true,
        minNoticeHours: true,
        lateCancelHours: true,
        missedVisitPolicy: true,
        deadPlantPolicy: true,
        customer: { select: { displayName: true } },
        customerAddress: {
          select: {
            label: true,
            addressLine1: true,
            addressLine2: true,
            neighborhood: true,
            city: true,
          },
        },
        slots: {
          select: { slot: { select: { weekday: true, startMinutes: true, endMinutes: true } } },
        },
        services: {
          orderBy: { createdAt: 'asc' },
          select: { name: true, pricing: true, unit: true, priceMinor: true },
        },
      },
    });
    if (!contract) return null;
    const [plants, upcoming, toReschedule, past, charges] = await Promise.all([
      tx.carePlant.findMany({
        where: { tenantId, subscriptionId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          quantity: true,
          size: true,
          location: true,
          light: true,
          watering: true,
          instructions: true,
        },
      }),
      tx.careVisit.findMany({
        where: {
          tenantId,
          subscriptionId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          scheduledDate: { gte: dbDate(today) },
        },
        orderBy: [{ scheduledDate: 'asc' }, { startMinutes: 'asc' }],
        take: UPCOMING_LIMIT,
        select: visitSelect,
      }),
      tx.careVisit.count({ where: { tenantId, subscriptionId, status: 'TO_RESCHEDULE' } }),
      tx.careVisit.findMany({
        where: { tenantId, subscriptionId, status: { in: ['DONE', 'NOT_DONE'] } },
        orderBy: [{ scheduledDate: 'desc' }, { startMinutes: 'desc' }],
        take: PAST_LIMIT,
        select: visitSelect,
      }),
      entry.canSeeMoney
        ? tx.careCharge.findMany({
            where: { tenantId, subscriptionId },
            orderBy: [{ period: 'desc' }, { number: 'desc' }],
            take: CHARGES_LIMIT,
            select: careChargeSummarySelect,
          })
        : Promise.resolve(null),
    ]);
    return { entry, contract, plants, upcoming, toReschedule, past, charges, today };
  });
  if (!found) throw new NotFoundError('CustomerSubscription');
  const { entry, contract, today } = found;
  const money = entry.canSeeMoney;
  const notice = noticeOf(contract.minNoticeHours);
  const visitContract = { status: contract.status, noticeHours: notice };
  const endDate = dateToParts(contract.endDate);
  const chargeItems = found.charges?.map((row) => toCareChargeSummary(row, today)) ?? null;
  return {
    subscriptionId,
    numberLabel: formatSubscriptionNumber(contract.number),
    status: contract.status,
    readOnly: entry.readOnly,
    canSeeMoney: money,
    shop: {
      name: entry.shop.name,
      contactEmail: entry.shop.contactEmail,
      contactPhone: entry.shop.contactPhone,
      timezone: entry.shop.timezone,
      country: entry.shop.marketCountry as MarketCountry,
    },
    customerName: contract.customer.displayName,
    site: contract.customerAddress,
    frequency: contract.frequency,
    slots: contract.slots
      .map((link) => link.slot)
      .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes)
      .map((slot) => ({
        weekday: slot.weekday,
        start: formatTimeOfDay(slot.startMinutes),
        end: formatTimeOfDay(slot.endMinutes),
      })),
    startDate: isoOf(contract.startDate) ?? '',
    endDate: isoOf(contract.endDate),
    rules: {
      minNoticeHours: notice,
      lateCancelHours: contract.lateCancelHours,
      missedVisitPolicy: contract.missedVisitPolicy,
      deadPlantPolicy: contract.deadPlantPolicy,
    },
    price: money
      ? {
          perVisitMinor: contract.perVisitMinor,
          oneTimeMinor: contract.oneTimeMinor,
          currency: contract.currency,
        }
      : null,
    services: contract.services.map((service) => ({
      name: service.name,
      pricing: service.pricing,
      unit: service.unit,
      priceMinor: money ? service.priceMinor : null,
    })),
    plants: found.plants,
    upcoming: found.upcoming.map((row) => toMyVisit(row, visitContract, entry.shop.timezone, now)),
    toReschedule: found.toReschedule,
    past: found.past.map((row) => toMyVisit(row, visitContract, entry.shop.timezone, now)),
    charges: chargeItems
      ? {
          items: chargeItems,
          dueMinor: chargeItems.reduce((sum, item) => sum + Math.max(0, item.balanceMinor), 0),
          overdueMinor: chargeItems
            .filter((item) => item.status === 'OVERDUE')
            .reduce((sum, item) => sum + Math.max(0, item.balanceMinor), 0),
          currency: contract.currency,
        }
      : null,
    termsText: entry.termsText,
    photosDeleteOn: entry.readOnly && endDate ? toIsoDate(carePhotoPurgeDate(endDate)) : null,
  };
}

export interface MyCareChargeDto extends CareChargeSummaryDto {
  readonly status: CareChargeStatus;
  readonly unitPriceMinor: number;
  readonly visitCount: number;
  readonly contractLabel: string;
  readonly customerName: string;
  readonly shopName: string;
  readonly lines: readonly CareChargeLineDto[];
}

/** Un cargo del contratto con le sue righe (solo con i soldi; i pagamenti restano alla fioreria). */
export async function getMyCareCharge(
  buyer: BuyerContext,
  subscriptionId: string,
  chargeId: string,
): Promise<MyCareChargeDto> {
  const now = new Date();
  const found = isUuid(chargeId)
    ? await openPortal(buyer, subscriptionId, async (tx, entry) => {
        if (!entry.canSeeMoney) return null;
        const charge = await tx.careCharge.findFirst({
          where: { tenantId: entry.tenantId, id: chargeId, subscriptionId },
          select: {
            ...careChargeSummarySelect,
            unitPriceMinor: true,
            visitCount: true,
            subscription: { select: { number: true } },
            customer: { select: { displayName: true } },
            lines: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                kind: true,
                quantity: true,
                unitPriceMinor: true,
                amountMinor: true,
                visitId: true,
                visitDate: true,
                creditReason: true,
                label: true,
                sourceCharge: { select: { id: true, number: true } },
              },
            },
          },
        });
        return charge ? { charge, entry } : null;
      })
    : null;
  if (!found) throw new NotFoundError('CareCharge');
  const { charge, entry } = found;
  const today = todayInTimeZone(entry.shop.timezone, now);
  return {
    ...toCareChargeSummary(charge, today),
    unitPriceMinor: charge.unitPriceMinor,
    visitCount: charge.visitCount,
    contractLabel: formatSubscriptionNumber(charge.subscription.number),
    customerName: charge.customer.displayName,
    shopName: entry.shop.name,
    lines: charge.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: line.amountMinor,
      visitId: line.visitId,
      visitDate: isoOf(line.visitDate),
      creditReason: line.creditReason,
      label: line.label,
      sourceCharge: line.sourceCharge
        ? {
            id: line.sourceCharge.id,
            numberLabel: `CAR-${String(line.sourceCharge.number).padStart(4, '0')}`,
          }
        : null,
    })),
  };
}

export interface MyCareVisitReportDto {
  readonly shopName: string;
  readonly timezone: string;
  readonly country: MarketCountry;
  readonly report: CareVisitReportDto;
}

/** Il resoconto di una visita fatta o "No se pudo" del contratto. */
export async function getMyCareVisitReport(
  buyer: BuyerContext,
  subscriptionId: string,
  visitId: string,
): Promise<MyCareVisitReportDto> {
  const found = isUuid(visitId)
    ? await openPortal(buyer, subscriptionId, async (tx, entry) => {
        const report = await loadCareVisitReportTx(
          tx,
          entry.tenantId,
          visitId,
          entry.shop.timezone,
        );
        if (!report || report.subscriptionId !== subscriptionId) return null;
        return {
          shopName: entry.shop.name,
          timezone: entry.shop.timezone,
          country: entry.shop.marketCountry as MarketCountry,
          report,
        };
      })
    : null;
  if (!found) throw new NotFoundError('CareVisit');
  return found;
}

/** Una foto del contratto (o la miniatura); null se non c'è, è tolta o cancellata. */
export async function getMyCarePhoto(
  buyer: BuyerContext,
  subscriptionId: string,
  photoId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage | null> {
  if (!isUuid(photoId)) return null;
  const photo = await openPortal(buyer, subscriptionId, (tx, entry) =>
    tx.carePhoto.findFirst({
      where: {
        tenantId: entry.tenantId,
        id: photoId,
        subscriptionId,
        removedAt: null,
        deletedAt: null,
      },
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return null;
  try {
    return await readStoredImage(
      variant === 'thumb' ? photo.thumbKey : photo.storageKey,
      photo.contentType,
      'CarePhoto',
    );
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

// -----------------------------------------------------------------------------
// Messaggi (blocco 5b)
// -----------------------------------------------------------------------------

export interface MyCareMessageDto {
  readonly id: string;
  /** Scritto dalla fioreria (altrimenti da una persona del cliente). */
  readonly fromShop: boolean;
  /** Scritto da questa persona. */
  readonly mine: boolean;
  /** Chi ha scritto; null = conto eliminato. */
  readonly authorName: string | null;
  readonly body: string;
  readonly photoId: string | null;
  /** C'era una foto che non si vede più (tolta dalla fioreria o cancellata). */
  readonly photoGone: boolean;
  readonly createdAt: Date;
  /** Della fioreria, arrivato dopo l'ultima lettura della persona. */
  readonly isNew: boolean;
}

export interface MyCareThreadDto {
  readonly subscriptionId: string;
  readonly shopName: string;
  /** Si scrive solo con il contratto attivo o in pausa. */
  readonly open: boolean;
  /** Dal più vecchio al più recente (gli ultimi `pages` × 30). */
  readonly messages: readonly MyCareMessageDto[];
  readonly hasOlder: boolean;
  readonly newCount: number;
}

/** Il filo del contratto per la persona, con i messaggi nuovi della fioreria. */
export async function getMyCareThread(
  buyer: BuyerContext,
  subscriptionId: string,
  pages = 1,
): Promise<MyCareThreadDto> {
  const take = CARE_MESSAGE_LIMITS.page * careMessagePages(pages);
  const found = await openPortal(buyer, subscriptionId, async (tx, entry) => {
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: entry.tenantId, id: subscriptionId },
      select: { status: true },
    });
    const rows = await tx.careMessage.findMany({
      where: { tenantId: entry.tenantId, subscriptionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: careMessageSelect,
    });
    const read = await tx.carePortalRead.findFirst({
      where: { tenantId: entry.tenantId, subscriptionId, userId: buyer.userId },
      select: { readAt: true },
    });
    return { entry, contract, rows, readAt: read?.readAt ?? null };
  });
  if (!found?.contract) throw new NotFoundError('CustomerSubscription');
  const { rows, readAt } = found;
  const messages = rows
    .slice(0, take)
    .reverse()
    .map((row) => {
      const dto = toCareMessageDto(row);
      const fromShop = row.authorKind === 'SHOP';
      return {
        id: dto.id,
        fromShop,
        mine: !fromShop && row.author !== null && row.authorUserId === buyer.userId,
        authorName: dto.authorName,
        body: dto.body,
        photoId: dto.photoId,
        photoGone: dto.photoGone,
        createdAt: dto.createdAt,
        isNew: fromShop && (readAt === null || row.createdAt > readAt),
      };
    });
  return {
    subscriptionId,
    shopName: found.entry.shop.name,
    open: careMessagesOpen(found.contract.status) && !found.entry.readOnly,
    messages,
    hasOlder: rows.length > take,
    newCount: messages.filter((message) => message.isNew).length,
  };
}

export interface MyCareMessagePostResult {
  readonly id: string;
  /** Lo stesso invio era già arrivato: nessun messaggio in più. */
  readonly duplicate: boolean;
}

/**
 * Scrive un messaggio della persona (testo e/o una foto) sul contratto, solo se è attivo o in
 * pausa e al massimo 30 al giorno. Scrive in modalità portale: le policy `portal_insert` del
 * database lasciano passare solo i propri messaggi sul contratto aperto. Alla fioreria nessuna
 * email: c'è il riassunto del giorno.
 */
export async function postMyCareMessage(
  buyer: BuyerContext,
  subscriptionId: string,
  rawInput: unknown,
  photo: Uint8Array | null,
): Promise<MyCareMessagePostResult> {
  assertBuyer(buyer);
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careMessageSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const hasPhoto = photo !== null && photo.byteLength > 0;
  // La fioreria del contratto (per la chiave della foto): solo dalle righe della persona.
  const tenantId = await contractTenant(buyer, subscriptionId);

  const check = async (tx: TransactionClient, entry: PortalEntry) => {
    const existing = await tx.careMessage.findFirst({
      where: { tenantId: entry.tenantId, submitKey: input.submitKey },
      select: { id: true },
    });
    if (existing) return { duplicate: existing.id };
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: entry.tenantId, id: subscriptionId },
      select: { status: true },
    });
    if (!contract) return null;
    const problem = careMessageProblem({
      status: entry.readOnly ? 'ENDED' : contract.status,
      body: input.body,
      hasPhoto,
    });
    if (problem === 'care_message_closed') throw new ConflictError(problem);
    if (problem === 'care_message_empty') throw new ValidationError({ body: problem });
    const today = await tx.careMessage.count({
      where: {
        tenantId: entry.tenantId,
        subscriptionId,
        authorUserId: buyer.userId,
        createdAt: { gte: careMessageDayStart(entry.shop.timezone) },
      },
    });
    if (today >= CARE_MESSAGE_LIMITS.perPersonPerDay) {
      throw new ConflictError('care_message_daily_limit');
    }
    return { duplicate: null };
  };

  // Prima un controllo veloce, così un messaggio rifiutato non elabora né carica la foto.
  const precheck = await openPortal(buyer, subscriptionId, check);
  if (!precheck) throw new NotFoundError('CustomerSubscription');
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true };

  const prepared = hasPhoto ? await prepareCareMessagePhoto(tenantId, subscriptionId, photo) : null;
  const id = newId();
  const commit = () =>
    openPortal(buyer, subscriptionId, async (tx, entry) => {
      if (entry.tenantId !== tenantId) return null;
      // Di nuovo dentro la transazione: un doppio invio o il contratto chiuso nel frattempo.
      const again = await check(tx, entry);
      if (!again) return null;
      if (again.duplicate) return { id: again.duplicate, duplicate: true };
      try {
        const created = await tx.careMessage.createManyAndReturn({
          data: [
            {
              id,
              tenantId: entry.tenantId,
              customerId: entry.customerId,
              subscriptionId,
              authorKind: 'CUSTOMER',
              authorUserId: buyer.userId,
              body: input.body,
              hasPhoto,
              submitKey: input.submitKey,
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        if (created.length === 0) {
          const existing = await tx.careMessage.findFirst({
            where: { tenantId: entry.tenantId, submitKey: input.submitKey },
            select: { id: true },
          });
          return { id: existing?.id ?? id, duplicate: true };
        }
        if (prepared) {
          await tx.carePhoto.create({
            data: {
              id: prepared.id,
              tenantId: entry.tenantId,
              subscriptionId,
              messageId: id,
              ...prepared.row,
              createdById: buyer.userId,
            },
            select: { id: true },
          });
        }
      } catch (error) {
        // La policy del portale rifiuta: il contratto non è più aperto (finito nel frattempo).
        if (isRlsViolation(error)) throw new ConflictError('care_message_closed');
        throw error;
      }
      return { id, duplicate: false };
    });
  const saved = prepared ? await storeFilesThenCommit(prepared.files, commit) : await commit();
  if (!saved) throw new NotFoundError('CustomerSubscription');
  if (saved.duplicate && prepared) {
    await deleteUnusedFiles(prepared.files.map((file) => file.key));
  }
  return saved;
}

/** "Letto": il segno della persona sul filo del contratto (lo scrive solo il database). */
export async function markMyCareThreadRead(
  buyer: BuyerContext,
  subscriptionId: string,
): Promise<void> {
  const marked = await openPortal(
    buyer,
    subscriptionId,
    (tx) => tx.$queryRaw<{ at: Date | null }[]>`SELECT app_portal_mark_read() AS at`,
  );
  if (!marked?.[0]?.at) throw new NotFoundError('CustomerSubscription');
}

// -----------------------------------------------------------------------------
// "Cambiar fecha"
// -----------------------------------------------------------------------------

export interface MyCareDateOptionDto {
  readonly date: string;
  readonly slotId: string;
  readonly start: string;
  readonly end: string;
}

export interface MyCareDateOptionsDto {
  readonly visit: MyCareVisitDto;
  readonly numberLabel: string;
  readonly shopName: string;
  readonly timezone: string;
  readonly noticeHours: number;
  /** Perché adesso non si può cambiare; null = si può. */
  readonly problem: CareCustomerChangeProblem | null;
  readonly options: readonly MyCareDateOptionDto[];
}

/** I giorni del contratto con una visita viva, senza questa (per "un giorno, una visita"). */
async function otherVisitDays(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  visitId: string,
  range: { readonly from: CalendarDate; readonly until: CalendarDate },
): Promise<Set<string>> {
  const rows = await tx.careVisit.findMany({
    where: {
      tenantId,
      subscriptionId,
      id: { not: visitId },
      status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
      scheduledDate: { gte: dbDate(range.from), lte: dbDate(range.until) },
    },
    select: { scheduledDate: true },
  });
  return new Set(rows.flatMap((row) => isoOf(row.scheduledDate) ?? []));
}

/** Le fasce libere per cambiare la data: stesso mese, dopo il preavviso, non bloccate. */
export async function getMyCareVisitDateOptions(
  buyer: BuyerContext,
  subscriptionId: string,
  visitId: string,
): Promise<MyCareDateOptionsDto> {
  assertBuyer(buyer);
  if (!isUuid(subscriptionId) || !isUuid(visitId)) throw new NotFoundError('CareVisit');
  const tenantId = await contractTenant(buyer, subscriptionId);
  const now = new Date();
  const found = await withPortalWriteContext(
    getDb(),
    { userId: buyer.userId, tenantId, subscriptionId },
    async (tx, entry) => {
      const timeZone = entry.shop.timezone;
      const row = await tx.careVisit.findFirst({
        where: { tenantId, id: visitId, subscriptionId },
        select: visitSelect,
      });
      if (!row) return null;
      const contract = await tx.customerSubscription.findFirstOrThrow({
        where: { tenantId, id: subscriptionId },
        select: {
          number: true,
          status: true,
          startDate: true,
          endDate: true,
          minNoticeHours: true,
        },
      });
      const notice = noticeOf(contract.minNoticeHours);
      const visit = toMyVisit(row, { status: contract.status, noticeHours: notice }, timeZone, now);
      const current = dateToParts(row.scheduledDate);
      const problem = careCustomerChangeProblem({
        contractStatus: contract.status,
        visit: { ...row, scheduledDate: current },
        noticeHours: notice,
        timeZone,
        now,
      });
      const base = {
        visit,
        numberLabel: formatSubscriptionNumber(contract.number),
        shopName: entry.shop.name,
        timezone: timeZone,
        noticeHours: notice,
        problem,
      };
      if (problem || !current || !row.slotId) return { ...base, options: [] };
      const month = careMonthBounds(current);
      const today = todayInTimeZone(timeZone, now);
      const end = dateToParts(contract.endDate);
      const from = laterDate(laterDate(month.from, today), requiredParts(contract.startDate));
      const until = end ? earlierDate(month.until, end) : month.until;
      if (compareDates(from, until) > 0) return { ...base, options: [] };
      const book = await openSlotBook(tx, tenantId, { from, until }, { lock: false });
      const busy = await otherVisitDays(tx, tenantId, subscriptionId, visitId, { from, until });
      const seats = await tx.careVisit.findFirstOrThrow({
        where: { tenantId, id: visitId },
        select: { seats: true },
      });
      const earliest = careCustomerEarliestStart(now, notice);
      const options: MyCareDateOptionDto[] = [];
      for (let day = from; compareDates(day, until) <= 0; day = addDays(day, 1)) {
        const iso = toIsoDate(day);
        if (busy.has(iso)) continue;
        for (const slot of book.activeSlots()) {
          if (slot.weekday !== dayOfWeek(day)) continue;
          if (compareDates(day, current) === 0 && slot.id === row.slotId) continue;
          if (book.blockFor(slot.id, day)) continue;
          if (book.free(slot.id, day) < seats.seats) continue;
          const start = careVisitStartAt(day, slot.startMinutes, timeZone);
          if (!start || start.getTime() < earliest.getTime()) continue;
          options.push({
            date: iso,
            slotId: slot.id,
            start: formatTimeOfDay(slot.startMinutes),
            end: formatTimeOfDay(slot.endMinutes),
          });
        }
      }
      return { ...base, options };
    },
  );
  if (!found) throw new NotFoundError('CareVisit');
  return found;
}

export interface MyCareChangeDeps {
  readonly mailer: Mailer;
  /** L'indirizzo completo della visita nell'Agenda della fioreria (lo costruisce il web). */
  readonly visitUrl: (tenantSlug: string, visitId: string) => string;
}

export interface MyCareChangeResult {
  readonly date: string;
  readonly start: string;
  readonly end: string;
}

/** "Cambiar fecha": la visita passa alla fascia scelta, con le regole del contratto. */
export async function changeMyCareVisitDate(
  buyer: BuyerContext,
  subscriptionId: string,
  visitId: string,
  rawInput: unknown,
  deps: MyCareChangeDeps,
  request?: RequestMeta,
): Promise<MyCareChangeResult> {
  assertBuyer(buyer);
  if (!isUuid(subscriptionId) || !isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = carePortalMoveSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const tenantId = await contractTenant(buyer, subscriptionId);
  const now = new Date();
  const result = await withPortalWriteContext(
    getDb(),
    { userId: buyer.userId, tenantId, subscriptionId },
    async (tx, entry) => {
      const timeZone = entry.shop.timezone;
      // Ordine dei blocchi: contratto, fasce, visita (come `moveCareVisit` e i blocchi di giorni).
      if (!(await lockSubscription(tx, tenantId, subscriptionId))) return null;
      const book = await openSlotBook(tx, tenantId, { from: input.date, until: input.date });
      const visit = await lockCareVisitTx(tx, tenantId, visitId);
      if (!visit || visit.subscriptionId !== subscriptionId) return null;
      const notice = noticeOf(visit.subscription.minNoticeHours);
      const current = dateToParts(visit.scheduledDate);
      const problem = careCustomerChangeProblem({
        contractStatus: visit.subscription.status,
        visit: { ...visit, scheduledDate: current },
        noticeHours: notice,
        timeZone,
        now,
      });
      if (problem) throw new ConflictError(problem);
      if (!current || !visit.slotId) throw new ConflictError('care_portal_move_not_allowed');
      const slot = book.slot(input.slotId);
      if (!slot?.active) throw new ValidationError({ slotId: 'invalid_option' });
      if (slot.weekday !== dayOfWeek(input.date)) {
        throw new ValidationError({ slotId: 'care_slot_weekday' });
      }
      const target = careCustomerTargetProblem({
        current: { date: current, slotId: visit.slotId },
        target: { date: input.date, slotId: slot.id, startMinutes: slot.startMinutes },
        contract: {
          startDate: requiredParts(visit.subscription.startDate),
          endDate: dateToParts(visit.subscription.endDate),
        },
        noticeHours: notice,
        timeZone,
        now,
      });
      if (target) {
        throw new ValidationError(
          target === 'care_portal_move_same' ? { slotId: target } : { date: target },
        );
      }
      if (book.blockFor(slot.id, input.date)) {
        throw new ValidationError({ slotId: 'care_day_blocked' });
      }
      const busy = await otherVisitDays(tx, tenantId, subscriptionId, visitId, {
        from: input.date,
        until: input.date,
      });
      if (busy.size > 0) throw new ValidationError({ date: 'care_portal_move_busy_day' });
      if (book.free(slot.id, input.date) < visit.seats) throw new ConflictError('care_slot_full');
      // La guardia del portale lascia aggiornare solo le visite di questo contratto.
      const updated = await tx.careVisit.updateMany({
        where: { tenantId, id: visit.id, subscriptionId, status: 'SCHEDULED' },
        data: {
          scheduledDate: dbDate(input.date),
          slotId: slot.id,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          customerMovedAt: now,
        },
      });
      if (updated.count !== 1) throw new ConflictError('care_portal_move_not_allowed');
      const numberLabel = formatSubscriptionNumber(visit.subscription.number);
      await recordPortalAudit(
        tx,
        { tenantId, userId: buyer.userId },
        {
          action: AUDIT_ACTIONS.careVisitMovedByCustomer,
          entityType: 'CareVisit',
          entityId: visit.id,
          metadata: {
            number: numberLabel,
            from: toIsoDate(current),
            to: toIsoDate(input.date),
            slotId: slot.id,
          },
        },
        request,
      );
      return {
        numberLabel,
        customerId: visit.subscription.customerId,
        from: {
          date: toIsoDate(current),
          start: visit.startMinutes === null ? null : formatTimeOfDay(visit.startMinutes),
          end: visit.endMinutes === null ? null : formatTimeOfDay(visit.endMinutes),
        },
        to: {
          date: toIsoDate(input.date),
          start: formatTimeOfDay(slot.startMinutes),
          end: formatTimeOfDay(slot.endMinutes),
        },
      };
    },
  );
  if (!result) throw new NotFoundError('CareVisit');
  await notifyShopOfChange(tenantId, visitId, result, deps);
  return result.to;
}

/** Dopo il commit: l'email a proprietari e gerenti (fioreria LIVE). Non fa mai fallire il cambio. */
async function notifyShopOfChange(
  tenantId: string,
  visitId: string,
  change: {
    readonly numberLabel: string;
    readonly customerId: string;
    readonly from: {
      readonly date: string;
      readonly start: string | null;
      readonly end: string | null;
    };
    readonly to: { readonly date: string; readonly start: string; readonly end: string };
  },
  deps: MyCareChangeDeps,
): Promise<void> {
  try {
    const facts = await withTenantContext(getDb(), { tenantId, userId: null }, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { slug: true, displayName: true, mode: true, status: true, marketCountry: true },
      });
      if (!tenant || !careEmailsAllowed(tenant)) return null;
      const [customer, emails] = await Promise.all([
        tx.customer.findFirst({
          where: { tenantId, id: change.customerId },
          select: { displayName: true },
        }),
        shopManagerEmailsTx(tx, tenantId),
      ]);
      return { tenant, customerName: customer?.displayName ?? '', emails };
    });
    if (!facts) return;
    const locale = resolveLocale(getMarket(facts.tenant.marketCountry).defaultLocale);
    const url = deps.visitUrl(facts.tenant.slug, visitId);
    for (const to of facts.emails) {
      await deps.mailer.send(
        careVisitMovedByCustomerEmail({
          locale,
          to,
          shopName: facts.tenant.displayName,
          customerName: facts.customerName,
          numberLabel: change.numberLabel,
          from: change.from,
          to_: change.to,
          url,
        }),
      );
    }
  } catch (error) {
    logger.error({ err: error, visitId }, 'avviso alla fioreria del cambio di data non riuscito');
  }
}

// -----------------------------------------------------------------------------
// Invito
// -----------------------------------------------------------------------------

export interface CarePortalInvitePreviewDto {
  readonly status: CarePortalInviteStatus;
  readonly shopName: string;
  /** L'email invitata: si entra o ci si registra con questa. */
  readonly email: string;
  readonly scope: CarePortalScope;
  readonly expiresAt: Date;
}

/** Cosa mostra la pagina dell'invito prima di accettare; null se il link non vale. */
export async function getCarePortalInvitePreview(
  secret: string,
  token: unknown,
): Promise<CarePortalInvitePreviewDto | null> {
  const ids = readCarePortalInviteToken(secret, token);
  if (!ids) return null;
  const now = new Date();
  return withTenantContext(getDb(), { tenantId: ids.tenantId, userId: null }, async (tx) => {
    const tenant = await tx.tenant.findFirst({
      where: { id: ids.tenantId, status: 'ACTIVE' },
      select: { displayName: true },
    });
    if (!tenant) return null;
    const invite = await tx.carePortalInvite.findFirst({
      where: { tenantId: ids.tenantId, id: ids.inviteId },
      select: { status: true, email: true, subscriptionId: true, expiresAt: true },
    });
    if (!invite) return null;
    return {
      status: carePortalInviteStatus(invite, now),
      shopName: tenant.displayName,
      email: invite.email,
      scope: invite.subscriptionId === null ? 'CUSTOMER' : 'CONTRACT',
      expiresAt: invite.expiresAt,
    };
  });
}

/**
 * Accetta l'invito: solo con la stessa email (verificata) dell'invito. Nasce l'accesso (o si
 * aggiorna quello che c'era per lo stesso ambito); un secondo clic non fa nulla. Ordine dei
 * blocchi: cliente → contratto → invito → accesso.
 */
export async function acceptCarePortalInvite(input: {
  readonly secret: string;
  readonly token: unknown;
  readonly buyer: BuyerContext;
  readonly userEmail: string;
  readonly request?: RequestMeta;
}): Promise<{ readonly subscriptionId: string | null }> {
  assertBuyer(input.buyer);
  const ids = readCarePortalInviteToken(input.secret, input.token);
  if (!ids) throw new NotFoundError('CarePortalInvite');
  const email = normalizeEmail(input.userEmail);
  const userId = input.buyer.userId;
  const now = new Date();
  const result = await withTenantContext(
    getDb(),
    { tenantId: ids.tenantId, userId },
    async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: ids.tenantId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!tenant) return null;
      const first = await tx.carePortalInvite.findFirst({
        where: { tenantId: ids.tenantId, id: ids.inviteId },
        select: { customerId: true, subscriptionId: true, email: true },
      });
      if (!first) return null;
      if (first.email !== email) throw new ConflictError('care_portal_email_mismatch');
      const customer = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status
        FROM "Customer"
        WHERE "tenantId" = ${ids.tenantId}::uuid AND "id" = ${first.customerId}::uuid FOR SHARE`;
      if (customer[0]?.status !== 'ACTIVE')
        throw new ConflictError('care_portal_customer_archived');
      if (first.subscriptionId) {
        const contract = await tx.$queryRaw<{ status: string; number: number }[]>`
          SELECT "status"::text AS status, "number" FROM "CustomerSubscription"
          WHERE "tenantId" = ${ids.tenantId}::uuid AND "id" = ${first.subscriptionId}::uuid
          FOR SHARE`;
        const status = contract[0]?.status;
        if (status !== 'ACTIVE' && status !== 'PAUSED') {
          throw new ConflictError('care_portal_contract_not_open');
        }
      }
      await tx.$queryRaw`SELECT "id" FROM "CarePortalInvite"
        WHERE "tenantId" = ${ids.tenantId}::uuid AND "id" = ${ids.inviteId}::uuid FOR UPDATE`;
      const invite = await tx.carePortalInvite.findFirstOrThrow({
        where: { tenantId: ids.tenantId, id: ids.inviteId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          acceptedUserId: true,
          customerId: true,
          subscriptionId: true,
          canSeeMoney: true,
        },
      });
      if (invite.status === 'ACCEPTED' && invite.acceptedUserId === userId) {
        return { subscriptionId: invite.subscriptionId };
      }
      const status = carePortalInviteStatus(invite, now);
      if (status === 'EXPIRED') throw new ConflictError('care_portal_invite_expired');
      if (status !== 'PENDING') throw new ConflictError('care_portal_invite_not_pending');
      await tx.carePortalInvite.update({
        where: { id: invite.id, tenantId: ids.tenantId },
        data: { status: 'ACCEPTED', acceptedAt: now, acceptedUserId: userId },
      });
      const existing = await tx.carePortalAccess.findFirst({
        where: {
          tenantId: ids.tenantId,
          customerId: invite.customerId,
          subscriptionId: invite.subscriptionId,
          userId,
          revokedAt: null,
        },
        select: { id: true },
      });
      const access = existing
        ? await tx.carePortalAccess.update({
            where: { id: existing.id, tenantId: ids.tenantId },
            data: { inviteId: invite.id, canSeeMoney: invite.canSeeMoney },
            select: { id: true },
          })
        : await tx.carePortalAccess.create({
            data: {
              tenantId: ids.tenantId,
              customerId: invite.customerId,
              subscriptionId: invite.subscriptionId,
              userId,
              inviteId: invite.id,
              canSeeMoney: invite.canSeeMoney,
            },
            select: { id: true },
          });
      await recordPortalAudit(
        tx,
        { tenantId: ids.tenantId, userId },
        {
          action: AUDIT_ACTIONS.carePortalAccessGranted,
          entityType: 'CarePortalAccess',
          entityId: access.id,
          metadata: {
            inviteId: invite.id,
            scope: invite.subscriptionId === null ? 'CUSTOMER' : 'CONTRACT',
            canSeeMoney: invite.canSeeMoney,
          },
        },
        input.request,
      );
      return { subscriptionId: invite.subscriptionId };
    },
  );
  if (!result) throw new NotFoundError('CarePortalInvite');
  // Il conto cliente si apre: chi non ha fiorerie arriva a "Mi cuenta" (ADR-064).
  await openBuyerAccount(input.buyer);
  return result;
}
