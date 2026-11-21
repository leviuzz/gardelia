/**
 * Bouquet Builder deterministico [AI-BQ-01…04, AI-BQ-06, BQ-01, BILL-01].
 *
 *  - Solo componenti del catalogo del tenant ATTIVI e abilitati al Builder (AI-BQ-01);
 *    gli articoli esauriti non si possono usare (mai sostituzioni silenziose).
 *  - Il prezzo lo calcola il server con `priceBouquet` rileggendo prezzi e costi dal DB:
 *    il client invia solo ID e quantità (AI-BQ-04). Nessuna AI nel prezzo.
 *  - Funzione del piano Plus: ogni operazione chiama `requireEntitlement` (BILL-01).
 *  - Il preventivo creato da un disegno contiene la distinta ESATTA con i prezzi del
 *    momento (snapshot), come le righe da catalogo (ORD-01).
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  AUDIT_ACTIONS,
  BUILDER_COMPONENT_TYPES,
  BUILDER_PAGE_SIZE,
  BUILDER_PRICING_VERSION,
  builderConfigurationSchema,
  builderRoleOf,
  builderSettingsSchema,
  formatQuoteNumber,
  isUuid,
  toFieldErrors,
  type Availability,
  type BuilderRole,
  type BuilderSize,
  type BuilderStyle,
  type CatalogItemType,
  type RecordStatus,
  type SaleUnit,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import {
  componentSelect,
  isUsable,
  laborFee,
  loadComponents,
  priceComponents,
  type PricedComponent,
} from './builder-internals';
import { insertDraftQuote, recalculateTotals } from './quote-internals';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface BuilderOptionDto {
  readonly id: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly role: BuilderRole;
  readonly saleUnit: SaleUnit;
  readonly priceMinor: number;
  /** null per chi non può vedere i costi. */
  readonly costMinor: number | null;
  readonly availability: Availability;
  readonly colors: readonly string[];
  /** Prima foto dell'articolo (miniatura), se c'è. */
  readonly coverPhotoId: string | null;
  /** Foto per colore (carte, vasi, nastri): la prima foto attiva di ogni colore. */
  readonly colorPhotos: readonly { readonly color: string; readonly photoId: string }[];
}

export interface BuilderCatalogDto {
  readonly options: readonly BuilderOptionDto[];
  readonly laborFeeMinor: number;
  readonly currency: string;
  readonly canViewCosts: boolean;
  /** Può trasformare un disegno in preventivo. */
  readonly canQuote: boolean;
}

export interface BouquetConfigurationLineDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly role: BuilderRole;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  /** Colore scelto per carta, vaso o nastro; null per gli altri componenti. */
  readonly color: string | null;
  /** Prezzo unitario al salvataggio. */
  readonly savedUnitPriceMinor: number;
  /** Prezzo unitario attuale di listino. */
  readonly currentUnitPriceMinor: number;
  readonly availability: Availability;
  /** false se l'articolo oggi non è più utilizzabile (archiviato, disabilitato, esaurito). */
  readonly usable: boolean;
}

export interface BouquetConfigurationSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly style: BuilderStyle | null;
  readonly size: BuilderSize | null;
  readonly totalMinor: number;
  readonly currency: string;
  readonly lineCount: number;
  readonly flowerCount: number;
  readonly status: RecordStatus;
  readonly updatedAt: Date;
}

export interface BouquetConfigurationDto extends BouquetConfigurationSummaryDto {
  readonly budgetMinor: number | null;
  readonly notes: string | null;
  readonly componentsMinor: number;
  readonly laborMinor: number;
  readonly estimatedCostMinor: number | null;
  readonly createdAt: Date;
  readonly lines: readonly BouquetConfigurationLineDto[];
}

export interface BouquetConfigurationListResult {
  readonly items: readonly BouquetConfigurationSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

/** Componenti disponibili nell'editor (anche gli esauriti, mostrati come non selezionabili). */
export async function getBuilderCatalog(ctx: TenantContext): Promise<BuilderCatalogDto> {
  requirePermission(ctx, 'builder:use');
  const canViewCosts = hasPermission(ctx, 'catalog:costs:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const items = await tx.catalogItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        isBuilderEnabled: true,
        type: { in: [...BUILDER_COMPONENT_TYPES] },
      },
      select: componentSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const photos = await tx.catalogItemPhoto.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        catalogItemId: { in: items.map((item) => item.id) },
      },
      select: { id: true, catalogItemId: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const coverOf = new Map<string, string>();
    const colorPhotosOf = new Map<string, Map<string, string>>();
    for (const photo of photos) {
      if (!coverOf.has(photo.catalogItemId)) coverOf.set(photo.catalogItemId, photo.id);
      if (photo.color === null) continue;
      const byColor = colorPhotosOf.get(photo.catalogItemId) ?? new Map<string, string>();
      if (!byColor.has(photo.color)) byColor.set(photo.color, photo.id);
      colorPhotosOf.set(photo.catalogItemId, byColor);
    }
    return {
      options: items.flatMap((item) => {
        const role = builderRoleOf(item.type);
        if (!role) return [];
        return [
          {
            id: item.id,
            name: item.name,
            variety: item.variety,
            type: item.type,
            role,
            saleUnit: item.saleUnit,
            priceMinor: item.priceMinor,
            costMinor: canViewCosts ? item.costMinor : null,
            availability: item.availability,
            colors: item.colors,
            coverPhotoId: coverOf.get(item.id) ?? null,
            colorPhotos: item.colors.flatMap((color) => {
              const photoId = colorPhotosOf.get(item.id)?.get(color);
              return photoId ? [{ color, photoId }] : [];
            }),
          },
        ];
      }),
      laborFeeMinor: await laborFee(tx, ctx),
      currency: ctx.currency,
      canViewCosts,
      canQuote: hasPermission(ctx, 'quotes:write'),
    };
  });
}

type ConfigurationWithLines = Prisma.BouquetConfigurationGetPayload<{
  include: { lines: { include: { catalogItem: { select: typeof componentSelect } } } };
}>;

function toSummary(config: ConfigurationWithLines): BouquetConfigurationSummaryDto {
  return {
    id: config.id,
    name: config.name,
    style: config.style,
    size: config.size,
    totalMinor: config.totalMinor,
    currency: config.currency,
    lineCount: config.lines.length,
    flowerCount: config.lines
      .filter((line) => line.role === 'FLOWER')
      .reduce((sum, line) => sum + line.quantity, 0),
    status: config.status,
    updatedAt: config.updatedAt,
  };
}

export async function listBouquetConfigurations(
  ctx: TenantContext,
  options: { readonly page?: number; readonly status?: RecordStatus } = {},
): Promise<BouquetConfigurationListResult> {
  requirePermission(ctx, 'builder:use');
  const status = options.status ?? 'ACTIVE';
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const where = { tenantId: ctx.tenantId, status };
    const total = await tx.bouquetConfiguration.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / BUILDER_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
    const configs = await tx.bouquetConfiguration.findMany({
      where,
      include: {
        lines: {
          where: { tenantId: ctx.tenantId },
          include: { catalogItem: { select: componentSelect } },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * BUILDER_PAGE_SIZE,
      take: BUILDER_PAGE_SIZE,
    });
    return { items: configs.map(toSummary), total, page, pageCount };
  });
}

export async function getBouquetConfiguration(
  ctx: TenantContext,
  configurationId: string,
): Promise<BouquetConfigurationDto> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const canViewCosts = hasPermission(ctx, 'catalog:costs:read');
  const config = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return tx.bouquetConfiguration.findFirst({
      where: { id: configurationId, tenantId: ctx.tenantId },
      include: {
        lines: {
          where: { tenantId: ctx.tenantId },
          include: { catalogItem: { select: componentSelect } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  });
  if (!config) return notFound(ctx, 'BouquetConfiguration', configurationId);
  return {
    ...toSummary(config),
    budgetMinor: config.budgetMinor,
    notes: config.notes,
    componentsMinor: config.componentsMinor,
    laborMinor: config.laborMinor,
    estimatedCostMinor: canViewCosts ? config.estimatedCostMinor : null,
    createdAt: config.createdAt,
    lines: config.lines.map((line) => ({
      catalogItemId: line.catalogItemId,
      name: line.catalogItem.name,
      variety: line.catalogItem.variety,
      role: line.role,
      saleUnit: line.catalogItem.saleUnit,
      quantity: line.quantity,
      color: line.color,
      savedUnitPriceMinor: line.unitPriceMinor,
      currentUnitPriceMinor: line.catalogItem.priceMinor,
      availability: line.catalogItem.availability,
      usable: isUsable(line.catalogItem),
    })),
  };
}

// -----------------------------------------------------------------------------
// Scrittura
// -----------------------------------------------------------------------------

function parseConfiguration(ctx: TenantContext, rawInput: unknown) {
  const parsed = builderConfigurationSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

function lineRows(ctx: TenantContext, configurationId: string, components: PricedComponent[]) {
  return components.map((component, index) => ({
    tenantId: ctx.tenantId,
    configurationId,
    catalogItemId: component.item.id,
    role: component.role,
    quantity: component.quantity,
    color: component.color,
    unitPriceMinor: component.item.priceMinor,
    unitCostMinor: component.item.costMinor,
    lineTotalMinor: component.quantity * component.item.priceMinor,
    sortOrder: index,
  }));
}

/**
 * Crea (senza `configurationId`) o sostituisce un disegno. Prezzi e costi vengono riletti
 * dal catalogo: i totali salvati sono lo snapshot "al salvataggio".
 */
export async function saveBouquetConfiguration(
  ctx: TenantContext,
  rawInput: unknown,
  configurationId?: string,
): Promise<{ id: string }> {
  requirePermission(ctx, 'builder:use');
  if (configurationId !== undefined && !isUuid(configurationId)) {
    throw new NotFoundError('BouquetConfiguration');
  }
  const input = parseConfiguration(ctx, rawInput);

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const components = await loadComponents(tx, ctx, input.lines);
    const pricing = priceComponents(components, await laborFee(tx, ctx));
    const data = {
      name: input.name,
      style: input.style,
      size: input.size,
      budgetMinor: input.budget,
      notes: input.notes,
      componentsMinor: pricing.componentsMinor,
      laborMinor: pricing.laborMinor,
      totalMinor: pricing.totalMinor,
      estimatedCostMinor: pricing.estimatedCostMinor,
      pricingVersion: BUILDER_PRICING_VERSION,
    };

    if (configurationId === undefined) {
      const created = await tx.bouquetConfiguration.create({
        data: {
          tenantId: ctx.tenantId,
          currency: ctx.currency,
          createdById: ctx.userId,
          ...data,
        },
      });
      await tx.bouquetConfigurationLine.createMany({
        data: lineRows(ctx, created.id, components),
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.builderConfigurationCreated,
        entityType: 'BouquetConfiguration',
        entityId: created.id,
        metadata: { name: created.name, totalMinor: created.totalMinor },
      });
      return { id: created.id };
    }

    const existing = await tx.bouquetConfiguration.findFirst({
      where: { id: configurationId, tenantId: ctx.tenantId },
      select: { id: true, status: true },
    });
    if (!existing) return null;
    if (existing.status !== 'ACTIVE') throw new ConflictError('builder_configuration_archived');
    await tx.bouquetConfiguration.update({ where: { id: existing.id }, data });
    await tx.bouquetConfigurationLine.deleteMany({
      where: { tenantId: ctx.tenantId, configurationId: existing.id },
    });
    await tx.bouquetConfigurationLine.createMany({
      data: lineRows(ctx, existing.id, components),
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.builderConfigurationUpdated,
      entityType: 'BouquetConfiguration',
      entityId: existing.id,
      metadata: { name: input.name, totalMinor: pricing.totalMinor },
    });
    return { id: existing.id };
  });
  if (!result) return notFound(ctx, 'BouquetConfiguration', configurationId ?? '');
  return result;
}

/** Archivia o ripristina un disegno (nessuna cancellazione fisica). */
export async function setBouquetConfigurationArchived(
  ctx: TenantContext,
  configurationId: string,
  archived: boolean,
): Promise<void> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const existing = await tx.bouquetConfiguration.findFirst({
      where: { id: configurationId, tenantId: ctx.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!existing) return false;
    const target = archived ? 'ARCHIVED' : 'ACTIVE';
    if (existing.status === target) return true;
    await tx.bouquetConfiguration.update({
      where: { id: existing.id },
      data: { status: target, archivedAt: archived ? new Date() : null },
    });
    await recordAudit(tx, ctx, {
      action: archived
        ? AUDIT_ACTIONS.builderConfigurationArchived
        : AUDIT_ACTIONS.builderConfigurationRestored,
      entityType: 'BouquetConfiguration',
      entityId: existing.id,
      metadata: { name: existing.name },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'BouquetConfiguration', configurationId);
}

/**
 * Crea un preventivo in bozza per il cliente con UNA riga "bouquet personalizzato":
 * prezzo ricalcolato adesso dal catalogo e distinta esatta nello snapshot.
 */
export async function createQuoteFromConfiguration(
  ctx: TenantContext,
  input: { readonly configurationId: unknown; readonly customerId: unknown },
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'quotes:write');
  requirePermission(ctx, 'builder:use');
  const configurationId =
    typeof input.configurationId === 'string' ? input.configurationId.trim() : '';
  const customerId = typeof input.customerId === 'string' ? input.customerId.trim() : '';
  if (!isUuid(customerId)) throw new ValidationError({ customerId: 'required' });
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const config = await tx.bouquetConfiguration.findFirst({
      where: { id: configurationId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      include: { lines: { where: { tenantId: ctx.tenantId } } },
    });
    if (!config) return { missing: 'BouquetConfiguration' as const };

    let components: PricedComponent[];
    try {
      components = await loadComponents(
        tx,
        ctx,
        config.lines.map((line) => ({
          catalogItemId: line.catalogItemId,
          quantity: line.quantity,
          color: line.color,
        })),
      );
    } catch (error) {
      // Il disegno è stato salvato valido: se ora non lo è, il catalogo è cambiato.
      if (error instanceof ValidationError)
        throw new ConflictError('builder_configuration_outdated');
      throw error;
    }
    const pricing = priceComponents(components, await laborFee(tx, ctx));

    const quote = await insertDraftQuote(tx, ctx, customerId);
    if (!quote) return { missing: 'Customer' as const };

    const snapshot = {
      version: 1,
      engine: BUILDER_PRICING_VERSION,
      builder: {
        configurationId: config.id,
        name: config.name,
        style: config.style,
        size: config.size,
        componentsMinor: pricing.componentsMinor,
        laborMinor: pricing.laborMinor,
      },
      recipe: components.map((component) => ({
        name: component.item.name,
        variety: component.item.variety,
        quantity: component.quantity,
        saleUnit: component.item.saleUnit,
        color: component.color,
      })),
      components: components.map((component) => ({
        catalogItemId: component.item.id,
        name: component.item.name,
        variety: component.item.variety,
        role: component.role,
        quantity: component.quantity,
        color: component.color,
        saleUnit: component.item.saleUnit,
        unitPriceMinor: component.item.priceMinor,
        availability: component.item.availability,
      })),
    };
    await tx.quoteLine.create({
      data: {
        tenantId: ctx.tenantId,
        quoteId: quote.id,
        kind: 'BUILDER',
        bouquetConfigurationId: config.id,
        description: config.name,
        quantity: 1,
        unitPriceMinor: pricing.totalMinor,
        // Costo dei materiali: l'armado è un ricavo del fiorista, non un costo stimato.
        unitCostMinor: pricing.estimatedCostMinor,
        lineTotalMinor: pricing.totalMinor,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        sortOrder: 0,
      },
    });
    await recalculateTotals(tx, ctx, quote.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.quoteLineAdded,
      entityType: 'Quote',
      entityId: quote.id,
      metadata: {
        number: formatQuoteNumber(quote.number),
        itemName: config.name,
        quantity: 1,
        configurationId: config.id,
      },
    });
    return { quote };
  });
  if ('missing' in result) {
    return result.missing === 'Customer'
      ? notFound(ctx, 'Customer', customerId)
      : notFound(ctx, 'BouquetConfiguration', configurationId);
  }
  return result.quote;
}

// -----------------------------------------------------------------------------
// Impostazioni del Builder
// -----------------------------------------------------------------------------

export async function getBuilderSettings(
  ctx: TenantContext,
): Promise<{ readonly laborFeeMinor: number }> {
  requirePermission(ctx, 'tenant:settings:update');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return { laborFeeMinor: await laborFee(tx, ctx) };
  });
}

export async function updateBuilderSettings(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = builderSettingsSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const previous = await laborFee(tx, ctx);
    if (previous === parsed.data.laborFee) return;
    await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: { builderLaborFeeMinor: parsed.data.laborFee },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: { changedFields: ['builderLaborFeeMinor'] },
    });
  });
}
