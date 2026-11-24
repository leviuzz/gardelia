/**
 * Registro di audit append-only (la tabella non ammette UPDATE/DELETE per il ruolo applicativo).
 * Le scritture di dominio avvengono nella STESSA transazione della modifica: o entrambe o nessuna.
 */
import { getDb, withSystemContext, type Prisma, type TransactionClient } from '@floral/db';
import { isUuid, type AuditAction } from '@floral/domain';
import type { RequestMeta, TenantContext } from './context';
import { NotFoundError } from './errors';
import { logger } from './logger';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(
  tx: TransactionClient,
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      requestId: ctx.request.requestId ?? null,
      ipAddress: ctx.request.ipAddress ?? null,
    },
  });
}

export interface PlatformSecurityEvent extends AuditEntry {
  readonly actorUserId: string | null;
  readonly request?: RequestMeta | undefined;
}

/** Evento di sicurezza a livello piattaforma (tenantId NULL: visibile solo agli admin). */
export async function recordPlatformSecurityEvent(event: PlatformSecurityEvent): Promise<void> {
  logger.warn(
    {
      action: event.action,
      actorUserId: event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      requestId: event.request?.requestId,
    },
    'evento di sicurezza',
  );
  await withSystemContext(getDb(), { reason: `security event: ${event.action}` }, (tx) =>
    tx.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        requestId: event.request?.requestId ?? null,
        ipAddress: event.request?.ipAddress ?? null,
      },
    }),
  );
}

type ProbeableEntity =
  | 'CatalogItem'
  | 'BouquetRecipeLine'
  | 'Membership'
  | 'Invitation'
  | 'Customer'
  | 'CustomerAddress'
  | 'CustomerOccasion'
  | 'Quote'
  | 'QuoteLine'
  | 'BouquetConfiguration'
  | 'AiJob'
  | 'CatalogItemPhoto'
  | 'StyleReferencePhoto'
  | 'BouquetPhoto'
  | 'OccasionPromoEmail'
  | 'Order'
  | 'OrderPayment'
  | 'DeliveryWindow'
  | 'DeliveryFeeTier'
  | 'InventoryItem'
  | 'InventoryEntry'
  | 'Supplier'
  | 'InventoryReservation'
  | 'CustomerImport'
  | 'CareTravelTier'
  | 'CareService'
  | 'CareSlot'
  | 'CustomerSubscription'
  | 'CarePlant'
  | 'CareVisit';

async function findOwningTenant(entity: ProbeableEntity, id: string): Promise<string | null> {
  return withSystemContext(
    getDb(),
    { reason: 'security: verifica accesso cross-tenant' },
    async (tx) => {
      const select = { tenantId: true } as const;
      switch (entity) {
        case 'CatalogItem':
          return (await tx.catalogItem.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'BouquetRecipeLine':
          return (
            (await tx.bouquetRecipeLine.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'Membership':
          return (await tx.membership.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'Invitation':
          return (await tx.invitation.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'Customer':
          return (await tx.customer.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CustomerAddress':
          return (await tx.customerAddress.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CustomerOccasion':
          return (
            (await tx.customerOccasion.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'Quote':
          return (await tx.quote.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'QuoteLine':
          return (await tx.quoteLine.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'AiJob':
          return (await tx.aiJob.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'BouquetConfiguration':
          return (
            (await tx.bouquetConfiguration.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'CatalogItemPhoto':
          return (
            (await tx.catalogItemPhoto.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'StyleReferencePhoto':
          return (
            (await tx.styleReferencePhoto.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'BouquetPhoto':
          return (await tx.bouquetPhoto.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'OccasionPromoEmail':
          return (
            (await tx.occasionPromoEmail.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'Order':
          return (await tx.order.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'OrderPayment':
          return (await tx.orderPayment.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'DeliveryWindow':
          return (await tx.deliveryWindow.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'DeliveryFeeTier':
          return (await tx.deliveryFeeTier.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'InventoryItem':
          return (await tx.inventoryItem.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'InventoryEntry':
          return (await tx.inventoryEntry.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'Supplier':
          return (await tx.supplier.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'InventoryReservation':
          return (
            (await tx.inventoryReservation.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'CustomerImport':
          return (await tx.customerImport.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CareTravelTier':
          return (await tx.careTravelTier.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CareService':
          return (await tx.careService.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CareSlot':
          return (await tx.careSlot.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CustomerSubscription':
          return (
            (await tx.customerSubscription.findUnique({ where: { id }, select }))?.tenantId ?? null
          );
        case 'CarePlant':
          return (await tx.carePlant.findUnique({ where: { id }, select }))?.tenantId ?? null;
        case 'CareVisit':
          return (await tx.careVisit.findUnique({ where: { id }, select }))?.tenantId ?? null;
      }
    },
  );
}

/**
 * Da usare quando un ID richiesto non esiste nel tenant corrente. Se l'ID appartiene a un
 * ALTRO tenant registra un tentativo di accesso cross-tenant (spec TEN-01: accesso negato
 * con audit). La risposta resta comunque un normale 404.
 */
export async function notFound(
  ctx: TenantContext,
  entity: ProbeableEntity,
  id: string,
): Promise<never> {
  if (isUuid(id)) {
    try {
      const owner = await findOwningTenant(entity, id);
      if (owner !== null && owner !== ctx.tenantId) {
        await recordPlatformSecurityEvent({
          action: 'security.cross_tenant_access_attempt',
          actorUserId: ctx.userId,
          entityType: entity,
          entityId: id,
          metadata: { actorTenantId: ctx.tenantId, targetTenantId: owner },
          request: ctx.request,
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'verifica cross-tenant non riuscita');
    }
  }
  throw new NotFoundError(entity);
}
