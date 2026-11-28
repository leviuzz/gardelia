/**
 * Marketplace M5 (ADR-089) — le richieste dei servizi della vetrina nell'app della fioreria: la voce
 * «Richieste» (elenco e pagina), «Rifiuta» con un motivo pronto, le foto di ispirazione (rotte
 * private) e i numeri per il menu e «Da gestire». Tutta la squadra le legge (`requests:read`);
 * proprietario e gerente rispondono (`requests:write`). Nel registro tipi e ID, mai i testi.
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  AUDIT_ACTIONS,
  SERVICE_REQUEST_FILTER_STATUSES,
  SERVICE_REQUEST_LIMITS,
  SERVICE_REQUEST_PAGE_SIZE,
  canShopDeclineServiceRequest,
  formatServiceRequestNumber,
  isUuid,
  serviceDeclineReasonText,
  serviceDeclineSchema,
  serviceRequestListFiltersSchema,
  toFieldErrors,
  type ServiceRequestFilter,
  type ServiceRequestStatus,
  type StorefrontServiceKind,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { getObjectStorage } from '../ai/storage';
import { readStoredImage, type StoredImage } from '../media/stored-files';
import { sendOrderMails, type OrderMailDeps } from '../order-mail';
import {
  isoDate,
  serviceRequestSelect,
  toServiceRequestDto,
  type ServiceRequestDetailDto,
} from '../service-request-internals';
import { buyerServiceRequestMailTx } from '../service-request-mail';

export interface ServiceRequestListItemDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly kind: StorefrontServiceKind;
  /** Solo i servizi della fioreria; i predefiniti hanno il nome dalla lingua. */
  readonly serviceName: string | null;
  readonly status: ServiceRequestStatus;
  readonly customerName: string | null;
  readonly preferredDate: string | null;
  readonly city: string | null;
  readonly createdAt: Date;
  readonly photoCount: number;
}

export interface ServiceRequestListResult {
  readonly filter: ServiceRequestFilter;
  readonly items: readonly ServiceRequestListItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  /** Le nuove: lo stesso numero del menu e di «Da gestire». */
  readonly newCount: number;
  readonly quotedCount: number;
}

/** Le richieste nuove (ancora senza risposta): menu, «Da gestire» e filtro «Nuove». */
const NEW_WHERE = { status: 'NEW' } as const;

/** «Richieste»: l'elenco con i filtri «Aperte», «Nuove», «Con preventivo», «Chiuse», «Tutte». */
export async function listServiceRequests(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<ServiceRequestListResult> {
  requirePermission(ctx, 'requests:read');
  const filters = serviceRequestListFiltersSchema.parse(rawFilters ?? {});
  const where: Prisma.ServiceRequestWhereInput = {
    tenantId: ctx.tenantId,
    status: { in: [...SERVICE_REQUEST_FILTER_STATUSES[filters.filter]] },
  };
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [total, newCount, quotedCount] = await Promise.all([
      tx.serviceRequest.count({ where }),
      tx.serviceRequest.count({ where: { tenantId: ctx.tenantId, ...NEW_WHERE } }),
      tx.serviceRequest.count({ where: { tenantId: ctx.tenantId, status: 'QUOTED' } }),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / SERVICE_REQUEST_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.serviceRequest.findMany({
      where,
      // Le più vecchie da gestire prima tra le aperte; le chiuse dalla più recente.
      orderBy:
        filters.filter === 'closed' || filters.filter === 'all'
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * SERVICE_REQUEST_PAGE_SIZE,
      take: SERVICE_REQUEST_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        kind: true,
        status: true,
        preferredDate: true,
        city: true,
        createdAt: true,
        service: { select: { name: true } },
        customer: { select: { displayName: true } },
        _count: { select: { photos: true } },
      },
    });
    return {
      filter: filters.filter,
      items: rows.map((row) => ({
        id: row.id,
        numberLabel: formatServiceRequestNumber(row.number),
        kind: row.kind as StorefrontServiceKind,
        serviceName: row.service.name,
        status: row.status as ServiceRequestStatus,
        customerName: row.customer?.displayName ?? null,
        preferredDate: isoDate(row.preferredDate),
        city: row.city,
        createdAt: row.createdAt,
        photoCount: row._count.photos,
      })),
      total,
      page,
      pageCount,
      newCount,
      quotedCount,
    };
  });
}

export interface ShopServiceRequestDto {
  readonly request: ServiceRequestDetailDto;
  /** Il cliente del CRM collegato (creato se mancava), con i contatti. */
  readonly customer: {
    readonly id: string;
    readonly displayName: string;
    readonly email: string | null;
    readonly phone: string | null;
  } | null;
  /** Chi l'ha fatta ha eliminato il conto: non riceve più le email. */
  readonly buyerDeleted: boolean;
  readonly canDecline: boolean;
}

/** La pagina della richiesta. Un ID di un'altra fioreria è un 404 con l'evento di sicurezza. */
export async function getServiceRequest(
  ctx: TenantContext,
  requestId: string,
): Promise<ShopServiceRequestDto> {
  requirePermission(ctx, 'requests:read');
  if (!isUuid(requestId)) throw new NotFoundError('ServiceRequest');
  const row = await withTenantContext(getDb(), ctx, (tx) =>
    tx.serviceRequest.findFirst({
      where: { tenantId: ctx.tenantId, id: requestId },
      select: {
        ...serviceRequestSelect,
        customer: { select: { id: true, displayName: true, email: true, phone: true } },
      },
    }),
  );
  if (!row) return notFound(ctx, 'ServiceRequest', requestId);
  const request = toServiceRequestDto(row);
  return {
    request,
    customer: row.customer,
    buyerDeleted: row.buyerUserId === null,
    canDecline:
      hasPermission(ctx, 'requests:write') && canShopDeclineServiceRequest(request.status),
  };
}

/** «Rifiuta»: un motivo pronto (con «Altro motivo» il testo); chi compra riceve un'email. */
export async function declineServiceRequest(
  ctx: TenantContext,
  requestId: string,
  rawInput: unknown,
  deps: OrderMailDeps | null,
): Promise<void> {
  requirePermission(ctx, 'requests:write');
  if (!isUuid(requestId)) throw new NotFoundError('ServiceRequest');
  const parsed = serviceDeclineSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; number: number; status: string }[]>`
      SELECT "id", "number", "status" FROM "ServiceRequest"
      WHERE "tenantId" = ${ctx.tenantId}::uuid AND "id" = ${requestId}::uuid FOR UPDATE`;
    const request = rows[0];
    if (!request) return null;
    if (!canShopDeclineServiceRequest(request.status as ServiceRequestStatus)) {
      throw new ConflictError('service_request_closed');
    }
    await tx.serviceRequest.update({
      where: { id: request.id, tenantId: ctx.tenantId },
      data: {
        status: 'DECLINED',
        statusChangedAt: new Date(),
        declineReasonCode: input.reasonCode,
        declineReason: serviceDeclineReasonText(input.reasonCode, input.detail),
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.serviceRequestDeclined,
      entityType: 'ServiceRequest',
      entityId: request.id,
      metadata: {
        number: formatServiceRequestNumber(request.number),
        reasonCode: input.reasonCode,
        withDetail: input.detail !== null,
      },
    });
    const mail = deps
      ? await buyerServiceRequestMailTx(tx, ctx.tenantId, request.id, 'declined', deps)
      : null;
    return { mails: mail ? [mail] : [] };
  });
  if (!result) return notFound(ctx, 'ServiceRequest', requestId);
  logger.info({ tenantId: ctx.tenantId, requestId }, 'richiesta rifiutata dalla fioreria');
  if (deps && result.mails.length > 0) await sendOrderMails(deps.mailer, result.mails);
}

/** Una foto di ispirazione di una richiesta (rotta privata dell'app). */
export async function getServiceRequestPhotoImage(
  ctx: TenantContext,
  requestId: string,
  photoId: string,
  variant: 'full' | 'thumb',
): Promise<StoredImage> {
  requirePermission(ctx, 'requests:read');
  if (!isUuid(requestId) || !isUuid(photoId)) throw new NotFoundError('ServiceRequestPhoto');
  const photo = await withTenantContext(getDb(), ctx, (tx) =>
    tx.serviceRequestPhoto.findFirst({
      where: { tenantId: ctx.tenantId, requestId, id: photoId, photoDeletedAt: null },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!photo) return notFound(ctx, 'ServiceRequestPhoto', photoId);
  return readStoredImage(
    variant === 'thumb' ? photo.photoThumbKey : photo.photoKey,
    'image/jpeg',
    'ServiceRequestPhoto',
  );
}

/** Le richieste nuove per «Da gestire»: tutta la squadra le vede. */
export async function countNewServiceRequests(ctx: TenantContext): Promise<number> {
  requirePermission(ctx, 'requests:read');
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.serviceRequest.count({ where: { tenantId: ctx.tenantId, ...NEW_WHERE } }),
  );
}

/**
 * Il numero sulla voce «Richieste» del menu: le nuove, solo per chi può rispondere (proprietario e
 * gerente); lo staff vede 0, come per gli ordini online da accettare.
 */
export async function serviceRequestsMenuCount(ctx: TenantContext): Promise<number> {
  requirePermission(ctx, 'requests:read');
  if (!hasPermission(ctx, 'requests:write')) return 0;
  return countNewServiceRequests(ctx);
}

/** Foto per giro del lavoro giornaliero (il resto al giro dopo). */
const PURGE_BATCH = 200;

/**
 * Lavoro giornaliero (M5): cancella i file delle foto di ispirazione 30 giorni dopo la chiusura della
 * richiesta (rifiutata, annullata o chiusa). La richiesta e le chiavi restano; `photoDeletedAt` dice
 * che i file non ci sono più. La funzione SQL dà solo gli ID; ogni foto si ricontrolla nella sua
 * fioreria.
 */
export async function purgeServiceRequestPhotos(): Promise<number> {
  const candidates = await getDb().$queryRaw<{ tenant_id: string; photo_id: string }[]>`
    SELECT tenant_id, photo_id
    FROM app_service_request_photos_to_purge(
      ${SERVICE_REQUEST_LIMITS.photoRetentionDays}::int,
      ${PURGE_BATCH}::int
    )`;
  const storage = getObjectStorage();
  let deleted = 0;
  for (const candidate of candidates) {
    try {
      const scope = { tenantId: candidate.tenant_id, userId: null };
      const photo = await withTenantContext(getDb(), scope, (tx) =>
        tx.serviceRequestPhoto.findFirst({
          where: { tenantId: candidate.tenant_id, id: candidate.photo_id, photoDeletedAt: null },
          select: { id: true, photoKey: true, photoThumbKey: true },
        }),
      );
      if (!photo) continue;
      await storage.delete(photo.photoKey);
      await storage.delete(photo.photoThumbKey);
      await withTenantContext(getDb(), scope, (tx) =>
        tx.serviceRequestPhoto.updateMany({
          where: { tenantId: candidate.tenant_id, id: photo.id, photoDeletedAt: null },
          data: { photoDeletedAt: new Date() },
        }),
      );
      deleted += 1;
    } catch (error) {
      logger.error(
        { err: error, photoId: candidate.photo_id },
        'foto di una richiesta non cancellata',
      );
    }
  }
  return deleted;
}
