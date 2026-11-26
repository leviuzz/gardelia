/**
 * Ruta del día e repartidor (ADR-058, blocco B2): chi porta ogni ordine a domicilio e le fermate del
 * giorno in ordine di fascia, con i dati che servono per strada (indirizzo, chi riceve, telefono,
 * indicazioni, cosa incassare). Il percorso su mappa lo apre Google Maps con link pubblici, senza
 * chiave (D-27). Niente costi né note interne.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  MX_REGIONS,
  formatOrderNumber,
  freshCoordinates,
  formatTimeOfDay,
  isOrderFinal,
  isUuid,
  orderBalanceMinor,
  orderRouteStops,
  parseIsoDate,
  todayInTimeZone,
  type CalendarDate,
  type Coordinates,
  type OrderStatus,
  type RouteStopWindow,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { allowedOrderSteps } from './orders';
import { formatDateParts, partsToDate } from './quote-internals';

export interface AssigneeOptionDto {
  readonly membershipId: string;
  readonly name: string;
}

/** Membri attivi della fioreria a cui assegnare una consegna. */
export async function listOrderAssignees(
  ctx: TenantContext,
): Promise<readonly AssigneeOptionDto[]> {
  requirePermission(ctx, 'orders:write');
  const members = await withTenantContext(getDb(), ctx, (tx) =>
    tx.membership.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, user: { select: { name: true } } },
    }),
  );
  return members
    .map((member) => ({ membershipId: member.id, name: member.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Assegna (o toglie, con vuoto) il repartidor di un ordine a domicilio ancora aperto. Il membro
 * deve essere attivo nella stessa fioreria.
 */
export async function assignOrder(
  ctx: TenantContext,
  orderId: string,
  rawMembershipId: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const membershipId =
    typeof rawMembershipId === 'string' && rawMembershipId.trim() !== ''
      ? rawMembershipId.trim()
      : null;
  if (membershipId !== null && !isUuid(membershipId)) {
    throw new ValidationError({ assignee: 'invalid_option' });
  }
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const [order] = await tx.$queryRaw<
      {
        id: string;
        number: number;
        status: OrderStatus;
        fulfillmentMode: 'DELIVERY' | 'PICKUP';
        assignedMembershipId: string | null;
      }[]
    >`SELECT "id", "number", "status", "fulfillmentMode", "assignedMembershipId" FROM "Order"
      WHERE "id" = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    if (!order) return false;
    if (order.fulfillmentMode !== 'DELIVERY') throw new ConflictError('order_not_delivery');
    if (order.status === 'DRAFT' || isOrderFinal(order.status)) {
      throw new ConflictError('order_not_editable');
    }
    if (membershipId !== null) {
      const member = await tx.membership.findFirst({
        where: { tenantId: ctx.tenantId, id: membershipId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!member) throw new ValidationError({ assignee: 'invalid_option' });
    }
    if (order.assignedMembershipId === membershipId) return true;
    await tx.order.update({
      where: { id: order.id },
      data: { assignedMembershipId: membershipId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderAssigned,
      entityType: 'Order',
      entityId: order.id,
      // ID del membro, mai nomi: nel registro niente dati personali.
      metadata: {
        number: formatOrderNumber(order.number),
        from: order.assignedMembershipId,
        to: membershipId,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

export interface RouteStopDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly status: OrderStatus;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly customerName: string;
  readonly customerPhone: string | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  /** Indirizzo completo in una riga, per mostrarlo e per Google Maps. */
  readonly address: string;
  readonly deliveryNotes: string | null;
  readonly assigneeName: string | null;
  readonly assignedToMe: boolean;
  /** Fatto da chi compra dalla tienda en línea (segno «Online», M3). */
  readonly placedOnline: boolean;
  /** Da incassare alla consegna (0 se pagato). */
  readonly balanceMinor: number;
  readonly currency: string;
  readonly nextSteps: readonly OrderStatus[];
}

export interface DeliveryRouteDto {
  readonly date: string;
  readonly isToday: boolean;
  /** Indirizzo della fioreria, partenza del giro (null se manca). */
  readonly origin: string | null;
  /**
   * Da consegnare, in ordine di fascia (quelle "in giornata" in fondo) e, dentro la fascia, per
   * vicinanza quando ci sono le coordinate (Google Places, ADR-059).
   */
  readonly stops: readonly RouteStopDto[];
  /** Almeno una fascia è stata ordinata per vicinanza. */
  readonly orderedByDistance: boolean;
  /** Già consegnati quel giorno. */
  readonly delivered: readonly RouteStopDto[];
  /** Ordini a domicilio di quel giorno senza repartidor. */
  readonly unassigned: number;
}

const ON_ROUTE: readonly OrderStatus[] = [
  'CONFIRMED',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

function oneLine(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(', ');
}

/** Una consegna del giorno con la sua fascia e le coordinate ancora valide, per ordinarle. */
export interface DeliveryStopRow {
  readonly stop: RouteStopDto;
  readonly window: RouteStopWindow;
  readonly coordinates: Coordinates | null;
}

export interface ShopOrigin {
  /** Indirizzo della fioreria in una riga (partenza del giro), o null. */
  readonly address: string | null;
  readonly coordinates: Coordinates | null;
}

/** La fioreria come partenza del giro: indirizzo e coordinate ancora valide (ADR-059). */
export async function loadShopOriginTx(
  tx: TransactionClient,
  ctx: TenantContext,
): Promise<ShopOrigin> {
  const location = await tx.location.findFirst({
    where: { tenantId: ctx.tenantId, isPrimary: true },
    select: {
      addressLine1: true,
      neighborhood: true,
      city: true,
      region: true,
      postalCode: true,
      latitude: true,
      longitude: true,
      coordinatesAt: true,
    },
  });
  if (!location) return { address: null, coordinates: null };
  return {
    address: oneLine([
      location.addressLine1,
      location.neighborhood,
      location.postalCode,
      location.city,
      regionName(location.region),
    ]),
    coordinates: freshCoordinates(location, new Date()),
  };
}

export function regionName(code: string): string {
  return MX_REGIONS.find((item) => item.code === code)?.name ?? code;
}

/**
 * Le consegne a domicilio del giorno (confermate fino a consegnate), con fascia e coordinate.
 * `mine`: solo quelle assegnate a chi guarda. Permesso già controllato da chi chiama.
 */
export async function loadDeliveryStopsTx(
  tx: TransactionClient,
  ctx: TenantContext,
  day: CalendarDate,
  options: { readonly mine?: boolean } = {},
): Promise<DeliveryStopRow[]> {
  const orders = await tx.order.findMany({
    where: {
      tenantId: ctx.tenantId,
      scheduledDate: partsToDate(day),
      fulfillmentMode: 'DELIVERY',
      status: { in: [...ON_ROUTE] },
      ...(options.mine ? { assignedMembershipId: ctx.membershipId } : {}),
    },
    include: {
      customer: { select: { displayName: true, phone: true } },
      assignedTo: { select: { id: true, user: { select: { name: true } } } },
    },
    orderBy: [{ windowStartMinutes: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }],
  });
  const now = new Date();
  return orders.map((order) => ({
    window: { start: order.windowStartMinutes, end: order.windowEndMinutes },
    // Coordinate solo se ancora valide (cache di 30 giorni, regole di Google).
    coordinates: freshCoordinates(
      {
        latitude: order.deliveryLatitude,
        longitude: order.deliveryLongitude,
        coordinatesAt: order.deliveryCoordinatesAt,
      },
      now,
    ),
    stop: {
      id: order.id,
      numberLabel: formatOrderNumber(order.number),
      status: order.status,
      windowStart:
        order.windowStartMinutes === null ? null : formatTimeOfDay(order.windowStartMinutes),
      windowEnd: order.windowEndMinutes === null ? null : formatTimeOfDay(order.windowEndMinutes),
      customerName: order.customer.displayName,
      customerPhone: order.customer.phone,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      address: oneLine([
        order.deliveryAddressLine1,
        order.deliveryAddressLine2,
        order.deliveryNeighborhood,
        order.deliveryPostalCode,
        order.deliveryCity,
        order.deliveryRegion ? regionName(order.deliveryRegion) : null,
      ]),
      deliveryNotes: order.deliveryNotes,
      assigneeName: order.assignedTo?.user.name ?? null,
      assignedToMe: order.assignedTo?.id === ctx.membershipId,
      placedOnline: order.placedOnline,
      balanceMinor: orderBalanceMinor(order.paidMinor, order.totalMinor),
      currency: order.currency,
      nextSteps: allowedOrderSteps(ctx, order.status, order.fulfillmentMode),
    },
  }));
}

/** `mine`: solo le consegne assegnate a chi guarda ("Mis entregas"). */
export async function getDeliveryRoute(
  ctx: TenantContext,
  rawDate: unknown,
  options: { readonly mine?: boolean } = {},
): Promise<DeliveryRouteDto> {
  requirePermission(ctx, 'orders:read');
  const today = todayInTimeZone(ctx.timezone);
  const day = parseIsoDate(rawDate) ?? today;
  const { rows, origin } = await withTenantContext(getDb(), ctx, async (tx) => ({
    rows: await loadDeliveryStopsTx(tx, ctx, day, options),
    origin: await loadShopOriginTx(tx, ctx),
  }));
  // Dentro ogni fascia: la più vicina a dove si è (la fioreria, poi l'ultima fermata).
  const pending = rows.filter((row) => row.stop.status !== 'DELIVERED');
  const ordered = orderRouteStops(pending, {
    origin: origin.coordinates,
    windowOf: (row) => row.window,
    coordinatesOf: (row) => row.coordinates,
  });
  return {
    date: formatDateParts(day) ?? '',
    isToday: formatDateParts(day) === formatDateParts(today),
    origin: origin.address,
    stops: ordered.stops.map((row) => row.stop),
    orderedByDistance: ordered.orderedByDistance,
    delivered: rows.filter((row) => row.stop.status === 'DELIVERED').map((row) => row.stop),
    unassigned: rows.filter(
      (row) => row.stop.status !== 'DELIVERED' && row.stop.assigneeName === null,
    ).length,
  };
}
