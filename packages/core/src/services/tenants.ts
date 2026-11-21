/**
 * Fioreria (tenant): creazione tramite onboarding e impostazioni [CORE-01].
 */
import {
  getDb,
  isUniqueViolation,
  withTenantContext,
  withUserContext,
  type Location,
  type Tenant,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  MARKETS,
  baseSlugFor,
  diffFields,
  locationSchema,
  newId,
  onboardingSchema,
  slugWithSuffix,
  tenantLegalSchema,
  tenantProfileSchema,
  toFieldErrors,
  type MarketCountry,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { RequestMeta, TenantContext } from '../context';
import { ConflictError, ValidationError } from '../errors';

/** Limite anti-abuso: fiorerie di cui un utente può essere proprietario. */
export const MAX_OWNED_TENANTS_PER_USER = 5;
const MAX_SLUG_ATTEMPTS = 20;

export interface CreateTenantInput {
  readonly userId: string;
  readonly country: MarketCountry;
  /** Valori grezzi del form di onboarding (validati qui). */
  readonly data: unknown;
  readonly request?: RequestMeta;
}

export async function createTenant(
  input: CreateTenantInput,
): Promise<{ tenantId: string; slug: string }> {
  const market = MARKETS[input.country];
  if (!market.enabled) throw new ValidationError({ country: 'invalid_option' });

  const parsed = onboardingSchema(input.country).safeParse(input.data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const data = parsed.data;

  const db = getDb();
  const ownedCount = await withUserContext(db, input.userId, (tx) =>
    tx.membership.count({ where: { userId: input.userId, role: 'OWNER', status: 'ACTIVE' } }),
  );
  if (ownedCount >= MAX_OWNED_TENANTS_PER_USER) throw new ConflictError('tenant_limit_reached');

  // L'ID è generato PRIMA dell'inserimento: serve per impostare il contesto RLS
  // (la policy di INSERT su Tenant richiede id = app.tenant_id).
  const tenantId = newId();
  const baseSlug = baseSlugFor(data.displayName);

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = slugWithSuffix(baseSlug, attempt);
    try {
      await withTenantContext(db, { tenantId, userId: input.userId }, async (tx) => {
        await tx.tenant.create({
          data: {
            id: tenantId,
            slug,
            displayName: data.displayName,
            legalName: data.legalName,
            taxId: data.taxId,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
            marketCountry: market.country,
            currency: market.currency,
            timezone: data.timezone,
            defaultLocale: market.defaultLocale,
            onboardingCompletedAt: new Date(),
          },
        });
        const membership = await tx.membership.create({
          data: { tenantId, userId: input.userId, role: 'OWNER' },
        });
        await tx.location.create({
          data: {
            tenantId,
            name: 'Principal',
            isPrimary: true,
            ...data.location,
            countryCode: market.country,
            timezone: data.timezone,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: input.userId,
            action: AUDIT_ACTIONS.tenantCreated,
            entityType: 'Tenant',
            entityId: tenantId,
            metadata: { slug, membershipId: membership.id },
            requestId: input.request?.requestId ?? null,
            ipAddress: input.request?.ipAddress ?? null,
          },
        });
      });
      return { tenantId, slug };
    } catch (error) {
      if (isUniqueViolation(error, 'slug')) continue;
      throw error;
    }
  }
  throw new ConflictError('slug_unavailable');
}

export interface TenantSettings {
  readonly tenant: Pick<
    Tenant,
    | 'id'
    | 'slug'
    | 'displayName'
    | 'legalName'
    | 'taxId'
    | 'contactEmail'
    | 'contactPhone'
    | 'timezone'
    | 'currency'
    | 'marketCountry'
    | 'mode'
  >;
  readonly location: Pick<
    Location,
    | 'id'
    | 'addressLine1'
    | 'addressLine2'
    | 'neighborhood'
    | 'city'
    | 'region'
    | 'postalCode'
    | 'phone'
    | 'deliveryRadiusKm'
  > | null;
}

export async function getTenantSettings(ctx: TenantContext): Promise<TenantSettings> {
  requirePermission(ctx, 'tenant:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: {
        id: true,
        slug: true,
        displayName: true,
        legalName: true,
        taxId: true,
        contactEmail: true,
        contactPhone: true,
        timezone: true,
        currency: true,
        marketCountry: true,
        mode: true,
      },
    });
    const location = await tx.location.findFirst({
      where: { tenantId: ctx.tenantId, isPrimary: true },
      select: {
        id: true,
        addressLine1: true,
        addressLine2: true,
        neighborhood: true,
        city: true,
        region: true,
        postalCode: true,
        phone: true,
        deliveryRadiusKm: true,
      },
    });
    return { tenant, location };
  });
}

const PROFILE_FIELDS = ['displayName', 'contactEmail', 'contactPhone', 'timezone'] as const;
const LEGAL_FIELDS = ['legalName', 'taxId'] as const;
const LOCATION_FIELDS = [
  'addressLine1',
  'addressLine2',
  'neighborhood',
  'city',
  'region',
  'postalCode',
  'phone',
  'deliveryRadiusKm',
] as const;

export async function updateTenantProfile(ctx: TenantContext, data: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = tenantProfileSchema(ctx.country).safeParse(data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));

  await withTenantContext(getDb(), ctx, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const changes = diffFields(before, parsed.data, PROFILE_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: parsed.data });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: { changes: JSON.parse(JSON.stringify(changes)) },
    });
  });
}

export async function updateTenantLegal(ctx: TenantContext, data: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:legal:update');
  const parsed = tenantLegalSchema(ctx.country).safeParse(data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));

  await withTenantContext(getDb(), ctx, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const changes = diffFields(before, parsed.data, LEGAL_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: parsed.data });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      // I valori fiscali non vengono copiati nel registro: si annota solo cosa è cambiato.
      metadata: { changedFields: Object.keys(changes) },
    });
  });
}

export async function updatePrimaryLocation(ctx: TenantContext, data: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = locationSchema(ctx.country).safeParse(data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));

  await withTenantContext(getDb(), ctx, async (tx) => {
    const existing = await tx.location.findFirst({
      where: { tenantId: ctx.tenantId, isPrimary: true },
    });
    if (!existing) {
      const created = await tx.location.create({
        data: {
          tenantId: ctx.tenantId,
          name: 'Principal',
          isPrimary: true,
          ...parsed.data,
          countryCode: ctx.country,
          timezone: ctx.timezone,
        },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.locationUpdated,
        entityType: 'Location',
        entityId: created.id,
        metadata: { created: true },
      });
      return;
    }
    const changes = diffFields(existing, parsed.data, LOCATION_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await tx.location.update({ where: { id: existing.id }, data: parsed.data });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.locationUpdated,
      entityType: 'Location',
      entityId: existing.id,
      metadata: { changes: JSON.parse(JSON.stringify(changes)) },
    });
  });
}
