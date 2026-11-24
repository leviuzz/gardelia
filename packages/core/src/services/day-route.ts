/**
 * La ruta del día dell'Agenda (ADR-078): le consegne a domicilio e le visite di Floral Care dello
 * stesso giorno in un solo giro, in ordine di fascia e, dentro la fascia, per vicinanza quando ci
 * sono le coordinate ancora valide (ADR-059: quelle dei clienti scadono dopo 30 giorni, quindi
 * spesso le visite restano in ordine di fascia). La pagina delle sole consegne (`/orders/route`,
 * ADR-058) resta com'è.
 *
 * Le visite entrano solo per chi vede i contratti (`subscriptions:read`) in una fioreria con
 * Floral Care: senza, la ruta è quella delle consegne e non dà mai errore di piano.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  CARE_VISIT_HOLDING_STATUSES,
  compareDates,
  formatSubscriptionNumber,
  formatTimeOfDay,
  freshCoordinates,
  orderRouteStops,
  parseIsoDate,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareVisitStatus,
  type Coordinates,
  type RouteStopWindow,
} from '@floral/domain';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { getEntitlements } from './billing';
import { dbDate } from './care-internals';
import { plantCounts } from './care-visit-internals';
import {
  loadDeliveryStopsTx,
  loadShopOriginTx,
  regionName,
  type RouteStopDto,
} from './delivery-route';

export interface RouteVisitStopDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly customerName: string;
  readonly status: CareVisitStatus;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly address: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly accessNotes: string | null;
  readonly assigneeName: string | null;
  readonly assignedToMe: boolean;
  readonly plantCount: number;
  readonly isExtra: boolean;
  readonly canStart: boolean;
  readonly canContinue: boolean;
}

export type DayRouteStop =
  | { readonly kind: 'delivery'; readonly delivery: RouteStopDto }
  | { readonly kind: 'visit'; readonly visit: RouteVisitStopDto };

export interface DayRouteDto {
  readonly date: string;
  readonly isToday: boolean;
  /** Indirizzo della fioreria, partenza del giro (null se manca). */
  readonly origin: string | null;
  /** Da fare, in ordine di giro. */
  readonly stops: readonly DayRouteStop[];
  readonly orderedByDistance: boolean;
  /** Già fatti quel giorno: consegnati, visite hechas o no realizadas. */
  readonly done: readonly DayRouteStop[];
  /** Fermate da fare senza persona assegnata. */
  readonly unassigned: number;
  /** Le visite di Floral Care fanno parte del giro (fioreria con Floral Care e permesso). */
  readonly includesVisits: boolean;
}

interface RouteRow {
  readonly stop: DayRouteStop;
  readonly window: RouteStopWindow;
  readonly coordinates: Coordinates | null;
  readonly done: boolean;
  readonly assigned: boolean;
}

function oneLine(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(', ');
}

async function loadVisitRowsTx(
  tx: TransactionClient,
  ctx: TenantContext,
  day: CalendarDate,
  today: CalendarDate,
  mine: boolean,
): Promise<RouteRow[]> {
  const visits = await tx.careVisit.findMany({
    where: {
      tenantId: ctx.tenantId,
      scheduledDate: dbDate(day),
      status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
      ...(mine ? { assignedMembershipId: ctx.membershipId } : {}),
    },
    orderBy: [{ startMinutes: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      status: true,
      subscriptionId: true,
      startMinutes: true,
      endMinutes: true,
      isExtra: true,
      assignedMembershipId: true,
      assignedTo: { select: { user: { select: { name: true } } } },
      subscription: {
        select: {
          number: true,
          contactName: true,
          contactPhone: true,
          accessNotes: true,
          customer: { select: { displayName: true, phone: true } },
          customerAddress: {
            select: {
              addressLine1: true,
              addressLine2: true,
              neighborhood: true,
              postalCode: true,
              city: true,
              region: true,
              latitude: true,
              longitude: true,
              coordinatesAt: true,
            },
          },
        },
      },
    },
  });
  const plants = await plantCounts(
    tx,
    ctx.tenantId,
    visits.map((visit) => visit.subscriptionId),
  );
  const now = new Date();
  const due = compareDates(day, today) <= 0;
  const canVisit = hasPermission(ctx, 'care:visit');
  return visits.map((visit) => {
    const address = visit.subscription.customerAddress;
    return {
      window: { start: visit.startMinutes, end: visit.endMinutes },
      coordinates: address ? freshCoordinates(address, now) : null,
      done: visit.status === 'DONE' || visit.status === 'NOT_DONE',
      assigned: visit.assignedMembershipId !== null,
      stop: {
        kind: 'visit' as const,
        visit: {
          id: visit.id,
          numberLabel: formatSubscriptionNumber(visit.subscription.number),
          customerName: visit.subscription.customer.displayName,
          status: visit.status,
          windowStart: visit.startMinutes === null ? null : formatTimeOfDay(visit.startMinutes),
          windowEnd: visit.endMinutes === null ? null : formatTimeOfDay(visit.endMinutes),
          address: address
            ? oneLine([
                address.addressLine1,
                address.addressLine2,
                address.neighborhood,
                address.postalCode,
                address.city,
                address.region ? regionName(address.region) : null,
              ])
            : null,
          contactName: visit.subscription.contactName,
          contactPhone: visit.subscription.contactPhone ?? visit.subscription.customer.phone,
          accessNotes: visit.subscription.accessNotes,
          assigneeName: visit.assignedTo?.user.name ?? null,
          assignedToMe: visit.assignedMembershipId === ctx.membershipId,
          plantCount: plants.get(visit.subscriptionId) ?? 0,
          isExtra: visit.isExtra,
          canStart: canVisit && visit.status === 'SCHEDULED' && due,
          canContinue: canVisit && visit.status === 'IN_PROGRESS',
        },
      },
    };
  });
}

/** Il giro del giorno con consegne e visite. `mine`: solo le fermate assegnate a chi guarda. */
export async function getDayRoute(
  ctx: TenantContext,
  rawDate: unknown,
  options: { readonly mine?: boolean } = {},
): Promise<DayRouteDto> {
  requirePermission(ctx, 'orders:read');
  const today = todayInTimeZone(ctx.timezone);
  const day = parseIsoDate(rawDate) ?? today;
  const mine = options.mine === true;
  const { rows, origin, includesVisits } = await withTenantContext(getDb(), ctx, async (tx) => {
    const deliveries = await loadDeliveryStopsTx(tx, ctx, day, { mine });
    const includesVisits =
      hasPermission(ctx, 'subscriptions:read') && (await getEntitlements(ctx, tx)).floralCare;
    const visits = includesVisits ? await loadVisitRowsTx(tx, ctx, day, today, mine) : [];
    const deliveryRows: RouteRow[] = deliveries.map((row) => ({
      stop: { kind: 'delivery' as const, delivery: row.stop },
      window: row.window,
      coordinates: row.coordinates,
      done: row.stop.status === 'DELIVERED',
      assigned: row.stop.assigneeName !== null,
    }));
    return {
      rows: [...deliveryRows, ...visits],
      origin: await loadShopOriginTx(tx, ctx),
      includesVisits,
    };
  });
  const pending = rows.filter((row) => !row.done);
  const ordered = orderRouteStops(pending, {
    origin: origin.coordinates,
    windowOf: (row) => row.window,
    coordinatesOf: (row) => row.coordinates,
  });
  return {
    date: toIsoDate(day),
    isToday: compareDates(day, today) === 0,
    origin: origin.address,
    stops: ordered.stops.map((row) => row.stop),
    orderedByDistance: ordered.orderedByDistance,
    done: rows.filter((row) => row.done).map((row) => row.stop),
    unassigned: pending.filter((row) => !row.assigned).length,
    includesVisits,
  };
}
