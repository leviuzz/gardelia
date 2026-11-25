/**
 * CRM: clienti, indirizzi e ricorrenze [CRM-01].
 *
 *  - lettura per tutti i ruoli (lo staff serve per le consegne), scrittura per OWNER/MANAGER;
 *  - dati fiscali (ragione sociale, RFC) visibili solo a chi può modificare i clienti;
 *  - l'origine del cliente è sempre MERCHANT_DIRECT: le origini della piattaforma
 *    (Network/Marketplace) non sono impostabili dal fiorista perché generano commissioni;
 *  - nel registro di audit nessun dato personale: solo ID, tipo e nomi dei campi cambiati.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CUSTOMER_LIMITS,
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_UPCOMING_DAYS,
  customerAddressSchema,
  customerInputSchema,
  customerListFiltersSchema,
  freshCoordinates,
  isUuid,
  nextOccurrence,
  nextStoredPlace,
  occasionInputListSchema,
  occasionSchema,
  toFieldErrors,
  upcomingMonthDays,
  type AcquisitionChannel,
  type AcquisitionSource,
  type Coordinates,
  type CustomerType,
  type OccasionType,
  type RecordStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { closeCustomerPortalTx } from './care-portal-internals';

export interface CustomerSummaryDto {
  readonly id: string;
  readonly type: CustomerType;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly tags: readonly string[];
  readonly status: RecordStatus;
  readonly acquisitionSource: AcquisitionSource;
}

export interface CustomerAddressDto {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly deliveryNotes: string | null;
  readonly isDefault: boolean;
  /** Google Places (ADR-059): presente se l'indirizzo è stato scelto fra i suggerimenti. */
  readonly placeId: string | null;
  /** Coordinate ancora valide (30 giorni), per il costo per distanza (ADR-069); o null. */
  readonly coordinates: Coordinates | null;
}

export interface CustomerOccasionDto {
  readonly id: string;
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  readonly month: number;
  readonly day: number;
  readonly year: number | null;
  readonly remindDaysBefore: number;
  readonly notes: string | null;
  readonly daysUntil: number;
}

export interface CustomerDetailDto extends CustomerSummaryDto {
  /** null per chi non può modificare i clienti (dati fiscali). */
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly notes: string | null;
  readonly preferences: string | null;
  readonly restrictions: string | null;
  readonly acquisitionChannel: AcquisitionChannel | null;
  readonly marketingConsent: boolean;
  readonly marketingConsentAt: Date | null;
  readonly createdAt: Date;
  readonly addresses: readonly CustomerAddressDto[];
  readonly occasions: readonly CustomerOccasionDto[];
  readonly canWrite: boolean;
}

function toSummary(customer: Prisma.CustomerGetPayload<object>): CustomerSummaryDto {
  return {
    id: customer.id,
    type: customer.type,
    displayName: customer.displayName,
    email: customer.email,
    phone: customer.phone,
    tags: customer.tags,
    status: customer.status,
    acquisitionSource: customer.acquisitionSource,
  };
}

function toAddressDto(address: Prisma.CustomerAddressGetPayload<object>): CustomerAddressDto {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    neighborhood: address.neighborhood,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    deliveryNotes: address.deliveryNotes,
    isDefault: address.isDefault,
    placeId: address.placeId,
    coordinates: freshCoordinates(address, new Date()),
  };
}

function toOccasionDto(
  occasion: Prisma.CustomerOccasionGetPayload<object>,
  timeZone: string,
): CustomerOccasionDto {
  return {
    id: occasion.id,
    type: occasion.type,
    label: occasion.label,
    personName: occasion.personName,
    month: occasion.month,
    day: occasion.day,
    year: occasion.year,
    remindDaysBefore: occasion.remindDaysBefore,
    notes: occasion.notes,
    daysUntil: nextOccurrence(occasion.month, occasion.day, timeZone).daysUntil,
  };
}

export interface CustomerListResult {
  readonly items: readonly CustomerSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly canWrite: boolean;
}

export async function listCustomers(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<CustomerListResult> {
  requirePermission(ctx, 'customers:read');
  const filters = customerListFiltersSchema.parse(rawFilters ?? {});
  const digits = filters.q.replace(/\D/g, '');
  const where: Prisma.CustomerWhereInput = {
    tenantId: ctx.tenantId,
    status: filters.status,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    ...(filters.consent ? { marketingConsent: filters.consent === 'yes' } : {}),
    // "Fecha especial próxima": una data speciale nei prossimi 30 giorni (come il pannello).
    ...(filters.upcoming
      ? {
          occasions: {
            some: {
              tenantId: ctx.tenantId,
              OR: upcomingMonthDays(ctx.timezone, CUSTOMER_UPCOMING_DAYS).map(
                ({ month, days }) => ({ month, day: { in: [...days] } }),
              ),
            },
          },
        }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { displayName: { contains: filters.q, mode: 'insensitive' } },
            { email: { contains: filters.q, mode: 'insensitive' } },
            { tags: { has: filters.q.toLowerCase() } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
  return withTenantContext(getDb(), ctx, async (tx) => {
    const total = await tx.customer.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const items = await tx.customer.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
    });
    return {
      items: items.map(toSummary),
      total,
      page,
      pageCount,
      canWrite: hasPermission(ctx, 'customers:write'),
    };
  });
}

export async function getCustomer(
  ctx: TenantContext,
  customerId: string,
): Promise<CustomerDetailDto> {
  requirePermission(ctx, 'customers:read');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const canWrite = hasPermission(ctx, 'customers:write');
  const customer = await withTenantContext(getDb(), ctx, (tx) =>
    tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
      include: {
        addresses: {
          where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        occasions: {
          where: { tenantId: ctx.tenantId },
          orderBy: [{ month: 'asc' }, { day: 'asc' }],
        },
      },
    }),
  );
  if (!customer) return notFound(ctx, 'Customer', customerId);
  return {
    ...toSummary(customer),
    legalName: canWrite ? customer.legalName : null,
    taxId: canWrite ? customer.taxId : null,
    notes: customer.notes,
    preferences: customer.preferences,
    restrictions: customer.restrictions,
    acquisitionChannel: customer.acquisitionChannel as AcquisitionChannel | null,
    marketingConsent: customer.marketingConsent,
    marketingConsentAt: customer.marketingConsentAt,
    createdAt: customer.createdAt,
    addresses: customer.addresses.map(toAddressDto),
    occasions: customer.occasions
      .map((occasion) => toOccasionDto(occasion, ctx.timezone))
      .sort((a, b) => a.daysUntil - b.daysUntil),
    canWrite,
  };
}

function parseCustomer(rawInput: unknown) {
  const parsed = customerInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

/** Nuovo cliente: i suoi dati più le date speciali inserite nello stesso modulo. */
const customerCreateSchema = customerInputSchema.extend({
  occasions: occasionInputListSchema.default([]),
});

/**
 * Crea il cliente e, nella stessa transazione, le sue date speciali (modulo "Nuevo cliente"):
 * o tutto o niente.
 */
export async function createCustomer(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'customers:write');
  const parsed = customerCreateSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { occasions, ...input } = parsed.data;
  return withTenantContext(getDb(), ctx, async (tx) => {
    const customer = await tx.customer.create({
      data: {
        tenantId: ctx.tenantId,
        type: input.type,
        displayName: input.displayName,
        legalName: input.legalName,
        taxId: input.taxId,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        preferences: input.preferences,
        restrictions: input.restrictions,
        tags: [...input.tags],
        acquisitionChannel: input.acquisitionChannel,
        // Sempre cliente diretto del fiorista: nessuna commissione di piattaforma.
        acquisitionSource: 'MERCHANT_DIRECT',
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? new Date() : null,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerCreated,
      entityType: 'Customer',
      entityId: customer.id,
      metadata: {
        type: customer.type,
        marketingConsent: customer.marketingConsent,
        occasions: occasions.length,
      },
    });
    for (const occasionInput of occasions) {
      const occasion = await tx.customerOccasion.create({
        data: { tenantId: ctx.tenantId, customerId: customer.id, ...occasionInput },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.customerOccasionAdded,
        entityType: 'CustomerOccasion',
        entityId: occasion.id,
        metadata: { customerId: customer.id, type: occasion.type },
      });
    }
    return { id: customer.id };
  });
}

const CUSTOMER_FIELDS = [
  'type',
  'displayName',
  'legalName',
  'taxId',
  'email',
  'phone',
  'notes',
  'preferences',
  'restrictions',
  'tags',
  'acquisitionChannel',
  'marketingConsent',
] as const;

export async function updateCustomer(
  ctx: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const input = parseCustomer(rawInput);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const existing = await tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
    });
    if (!existing) return false;
    const changedFields = CUSTOMER_FIELDS.filter(
      (field) => JSON.stringify(existing[field]) !== JSON.stringify(input[field]),
    );
    if (changedFields.length === 0) return true;
    const consentChanged = existing.marketingConsent !== input.marketingConsent;
    await tx.customer.update({
      where: { id: existing.id },
      data: {
        type: input.type,
        displayName: input.displayName,
        legalName: input.legalName,
        taxId: input.taxId,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        preferences: input.preferences,
        restrictions: input.restrictions,
        tags: [...input.tags],
        acquisitionChannel: input.acquisitionChannel,
        marketingConsent: input.marketingConsent,
        ...(consentChanged
          ? { marketingConsentAt: input.marketingConsent ? new Date() : null }
          : {}),
      },
    });
    // Solo i NOMI dei campi: nessun dato personale nel registro.
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerUpdated,
      entityType: 'Customer',
      entityId: existing.id,
      metadata: {
        changedFields: [...changedFields],
        ...(consentChanged ? { marketingConsent: input.marketingConsent } : {}),
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Customer', customerId);
}

export async function setCustomerArchived(
  ctx: TenantContext,
  customerId: string,
  archived: boolean,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const existing = await tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
    });
    if (!existing) return false;
    const target: RecordStatus = archived ? 'ARCHIVED' : 'ACTIVE';
    if (existing.status === target) return true;
    await tx.customer.update({ where: { id: existing.id }, data: { status: target } });
    // Archiviato: chi lo seguiva dalla pagina di Floral Care non lo vede più (ADR-084).
    if (archived) await closeCustomerPortalTx(tx, ctx.tenantId, existing.id, ctx.userId);
    await recordAudit(tx, ctx, {
      action: archived ? AUDIT_ACTIONS.customerArchived : AUDIT_ACTIONS.customerRestored,
      entityType: 'Customer',
      entityId: existing.id,
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Customer', customerId);
}

// -----------------------------------------------------------------------------
// Indirizzi
// -----------------------------------------------------------------------------

async function loadCustomer(tx: TransactionClient, ctx: TenantContext, customerId: string) {
  return tx.customer.findFirst({
    where: { id: customerId, tenantId: ctx.tenantId },
    select: { id: true },
  });
}

/** Campi di Google Places del form (nascosti, li compila la ricerca dell'indirizzo). */
function placeFields(rawInput: unknown): Record<string, unknown> {
  return rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
}

function parseAddress(ctx: TenantContext, rawInput: unknown) {
  const parsed = customerAddressSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

export async function addCustomerAddress(
  ctx: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const input = parseAddress(ctx, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await loadCustomer(tx, ctx, customerId))) return null;
    const activeCount = await tx.customerAddress.count({
      where: { tenantId: ctx.tenantId, customerId, status: 'ACTIVE' },
    });
    if (activeCount >= CUSTOMER_LIMITS.addressesPerCustomer) {
      throw new ValidationError({ _form: 'too_many_items' });
    }
    // Il primo indirizzo diventa predefinito; un nuovo predefinito sostituisce il precedente.
    const isDefault = input.isDefault || activeCount === 0;
    if (isDefault) {
      await tx.customerAddress.updateMany({
        where: { tenantId: ctx.tenantId, customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const address = await tx.customerAddress.create({
      data: {
        tenantId: ctx.tenantId,
        customerId,
        ...input,
        // Google Places (ADR-059): solo se l'indirizzo è stato scelto fra i suggerimenti.
        ...nextStoredPlace(placeFields(rawInput), null, new Date()),
        isDefault,
        countryCode: ctx.country,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerAddressAdded,
      entityType: 'CustomerAddress',
      entityId: address.id,
      metadata: { customerId },
    });
    return { id: address.id };
  });
  if (!result) return notFound(ctx, 'Customer', customerId);
  return result;
}

export async function updateCustomerAddress(
  ctx: TenantContext,
  customerId: string,
  addressId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId) || !isUuid(addressId)) throw new NotFoundError('CustomerAddress');
  const input = parseAddress(ctx, rawInput);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const address = await tx.customerAddress.findFirst({
      where: { id: addressId, tenantId: ctx.tenantId, customerId, status: 'ACTIVE' },
    });
    if (!address) return false;
    if (input.isDefault && !address.isDefault) {
      await tx.customerAddress.updateMany({
        where: { tenantId: ctx.tenantId, customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    await tx.customerAddress.update({
      where: { id: address.id },
      // Non si può togliere il flag all'unico predefinito senza sceglierne un altro.
      data: {
        ...input,
        ...nextStoredPlace(placeFields(rawInput), address, new Date()),
        isDefault: input.isDefault || address.isDefault,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerAddressUpdated,
      entityType: 'CustomerAddress',
      entityId: address.id,
      metadata: { customerId },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerAddress', addressId);
}

export async function archiveCustomerAddress(
  ctx: TenantContext,
  customerId: string,
  addressId: string,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId) || !isUuid(addressId)) throw new NotFoundError('CustomerAddress');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const address = await tx.customerAddress.findFirst({
      where: { id: addressId, tenantId: ctx.tenantId, customerId, status: 'ACTIVE' },
    });
    if (!address) return false;
    await tx.customerAddress.update({
      where: { id: address.id },
      data: { status: 'ARCHIVED', isDefault: false },
    });
    if (address.isDefault) {
      // Promuove a predefinito l'indirizzo attivo più vecchio, se esiste.
      const next = await tx.customerAddress.findFirst({
        where: { tenantId: ctx.tenantId, customerId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      if (next)
        await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerAddressArchived,
      entityType: 'CustomerAddress',
      entityId: address.id,
      metadata: { customerId },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerAddress', addressId);
}

// -----------------------------------------------------------------------------
// Ricorrenze
// -----------------------------------------------------------------------------

export async function addCustomerOccasion(
  ctx: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const parsed = occasionSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await loadCustomer(tx, ctx, customerId))) return null;
    const count = await tx.customerOccasion.count({
      where: { tenantId: ctx.tenantId, customerId },
    });
    if (count >= CUSTOMER_LIMITS.occasionsPerCustomer) throw new ConflictError('occasion_limit');
    const occasion = await tx.customerOccasion.create({
      data: { tenantId: ctx.tenantId, customerId, ...input },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerOccasionAdded,
      entityType: 'CustomerOccasion',
      entityId: occasion.id,
      metadata: { customerId, type: occasion.type },
    });
    return { id: occasion.id };
  });
  if (!result) return notFound(ctx, 'Customer', customerId);
  return result;
}

export async function removeCustomerOccasion(
  ctx: TenantContext,
  customerId: string,
  occasionId: string,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(customerId) || !isUuid(occasionId)) throw new NotFoundError('CustomerOccasion');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const occasion = await tx.customerOccasion.findFirst({
      where: { id: occasionId, tenantId: ctx.tenantId, customerId },
    });
    if (!occasion) return false;
    await tx.customerOccasion.delete({ where: { id: occasion.id } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customerOccasionRemoved,
      entityType: 'CustomerOccasion',
      entityId: occasion.id,
      metadata: { customerId, type: occasion.type },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerOccasion', occasionId);
}

export interface UpcomingOccasionDto {
  readonly occasionId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  readonly daysUntil: number;
  readonly month: number;
  readonly day: number;
  /** true se siamo dentro la finestra di promemoria scelta per la ricorrenza. */
  readonly inReminderWindow: boolean;
}

/** Ricorrenze dei prossimi `withinDays` giorni (clienti attivi), ordinate per vicinanza. */
export async function listUpcomingOccasions(
  ctx: TenantContext,
  options: { withinDays?: number; limit?: number } = {},
): Promise<readonly UpcomingOccasionDto[]> {
  requirePermission(ctx, 'customers:read');
  const withinDays = options.withinDays ?? 30;
  const occasions = await withTenantContext(getDb(), ctx, (tx) =>
    tx.customerOccasion.findMany({
      where: { tenantId: ctx.tenantId, customer: { status: 'ACTIVE' } },
      include: { customer: { select: { displayName: true } } },
      take: 2000,
    }),
  );
  return occasions
    .map((occasion) => {
      const next = nextOccurrence(occasion.month, occasion.day, ctx.timezone);
      return {
        occasionId: occasion.id,
        customerId: occasion.customerId,
        customerName: occasion.customer.displayName,
        type: occasion.type,
        label: occasion.label,
        personName: occasion.personName,
        daysUntil: next.daysUntil,
        month: next.month,
        day: next.day,
        inReminderWindow: next.daysUntil <= occasion.remindDaysBefore,
      };
    })
    .filter((occasion) => occasion.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, options.limit ?? 10);
}
