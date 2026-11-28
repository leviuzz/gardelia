/**
 * Marketplace M5 (ADR-089) — le richieste dei servizi della vetrina viste e usate da chi le fa, dal
 * suo conto: il modulo, l'invio, «Mis solicitudes», la pagina della richiesta, «Cancelar solicitud»
 * e le foto di ispirazione.
 *
 * L'invio è come quello di un ordine online (`placeMarketplaceOrder`): la fioreria dallo slug
 * pubblicato, poi il contesto della fioreria con l'utente di chi compra e la RLS attiva. Tutto il
 * resto passa da `withBuyerRequest`: la fioreria la dà `app_buyer_request_shop` (solo per le
 * richieste della persona), poi il contesto della fioreria con la guardia `app.buyer_request_id`
 * (le tabelle della richiesta danno e accettano solo le righe di quella richiesta) e il controllo
 * che sia della persona e che la fioreria sia attiva. Una richiesta di un altro risponde 404 come
 * una inesistente.
 */
import {
  getDb,
  withBuyerRequestContext,
  withTenantContext,
  withUserContext,
  type TransactionClient,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  LEGAL_VERSION,
  SERVICE_REQUEST_LIMITS,
  addDays,
  addMonths,
  canBuyerCancelServiceRequest,
  formatServiceRequestNumber,
  formatTimeOfDay,
  isUuid,
  newId,
  resolveLocale,
  serviceRequestAddressSchema,
  serviceRequestAnswers,
  serviceRequestDateProblem,
  serviceRequestNeedsAddress,
  serviceRequestProblem,
  serviceRequestSchema,
  toFieldErrors,
  toIsoDate,
  todayInTimeZone,
  type CareFrequency,
  type CurrencyCode,
  type ServiceRequestAddressInput,
  type ServiceRequestStatus,
  type StorefrontServiceKind,
  type SupportedLocale,
} from '@floral/domain';
import { linkBuyerCustomerTx } from './buyer-customer';
import type { RequestMeta } from './context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { logger } from './logger';
import { normalizeUploadedPhoto } from './media/images';
import {
  deleteUnusedFiles,
  readStoredImage,
  storeFilesThenCommit,
  type FileToStore,
  type StoredImage,
} from './media/stored-files';
import { sendOrderMails, type OrderMailDeps } from './order-mail';
import { publishedTenantId, readPublishedServiceTx } from './public-store';
import {
  isoDate,
  serviceRequestSelect,
  toServiceRequestDto,
  type ServiceRequestDetailDto,
} from './service-request-internals';
import { buyerServiceRequestMailTx, shopServiceRequestMailsTx } from './service-request-mail';
import type { BuyerAddressDto, BuyerContext } from './services/buyer-account';
import { loadCareSettings } from './services/care-internals';
import { careOfferReadyTx } from './services/storefront-services';
import { nextTenantCounter, partsToDate } from './services/quote-internals';

function assertBuyer(buyer: BuyerContext): void {
  if (!isUuid(buyer.userId)) throw new TypeError('BuyerContext senza un utente valido');
}

/** Le richieste aperte (nuove o con preventivo): il limite per persona e fioreria. */
const OPEN_STATUSES = ['NEW', 'QUOTED'] as const;

// -----------------------------------------------------------------------------
// L'ingresso unico a una richiesta esistente
// -----------------------------------------------------------------------------

/** La fioreria della richiesta, come la vede chi l'ha fatta. */
export interface BuyerRequestShop {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

interface BuyerRequestRow {
  readonly id: string;
  readonly number: number;
  readonly status: string;
  readonly buyerUserId: string | null;
}

export interface BuyerRequestScope {
  readonly shop: BuyerRequestShop;
  readonly request: BuyerRequestRow;
}

/**
 * Il solo ingresso di chi compra a una sua richiesta: trova la fioreria, apre il suo contesto con
 * la guardia sulla richiesta, la blocca se serve (`lock`) e ricontrolla proprietario e fioreria
 * attiva. NotFoundError in ogni altro caso.
 */
export async function withBuyerRequest<T>(
  buyer: BuyerContext,
  requestId: string,
  fn: (tx: TransactionClient, scope: BuyerRequestScope) => Promise<T>,
  options: { readonly lock?: boolean } = {},
): Promise<T> {
  assertBuyer(buyer);
  if (!isUuid(requestId)) throw new NotFoundError('ServiceRequest');
  const rows = await withUserContext(
    getDb(),
    buyer.userId,
    (tx) =>
      tx.$queryRaw<
        { tenant_id: string; shop_slug: string; shop_name: string; shop_active: boolean }[]
      >`SELECT * FROM app_buyer_request_shop(${requestId}::uuid)`,
  );
  const found = rows[0];
  // Una fioreria in eliminazione (ADR-074) sparisce anche da qui.
  if (!found || !found.shop_active) throw new NotFoundError('ServiceRequest');
  const shop = { tenantId: found.tenant_id, slug: found.shop_slug, name: found.shop_name };
  return withBuyerRequestContext(
    getDb(),
    { tenantId: shop.tenantId, userId: buyer.userId, requestId },
    async (tx) => {
      if (options.lock) {
        await tx.$queryRaw`SELECT id FROM "ServiceRequest" WHERE id = ${requestId}::uuid
          AND "tenantId" = ${shop.tenantId}::uuid FOR UPDATE`;
      }
      const request = await tx.serviceRequest.findFirst({
        where: { tenantId: shop.tenantId, id: requestId },
        select: { id: true, number: true, status: true, buyerUserId: true },
      });
      if (!request || request.buyerUserId !== buyer.userId) {
        throw new NotFoundError('ServiceRequest');
      }
      return fn(tx, { shop, request });
    },
  );
}

// -----------------------------------------------------------------------------
// Il modulo
// -----------------------------------------------------------------------------

export interface ServiceRequestFormDto {
  readonly store: {
    readonly slug: string;
    readonly name: string;
    readonly locale: SupportedLocale;
    readonly currency: string;
  };
  readonly service: {
    readonly id: string;
    readonly kind: StorefrontServiceKind;
    readonly name: string | null;
    readonly askDate: boolean;
    readonly askAddress: boolean;
  };
  /** Il modulo chiede un indirizzo (salvato o nuovo). */
  readonly needsAddress: boolean;
  /** Le date che si possono scegliere (`YYYY-MM-DD`, ora della fioreria): da domani a 12 mesi. */
  readonly minDate: string;
  readonly maxDate: string;
  /** «Flores cada semana»: le fasce della fioreria e i giorni in cui non consegna. */
  readonly windows: readonly { readonly start: string; readonly end: string }[];
  readonly closedWeekdays: readonly number[];
  /** Floral Care: le frequenze che la fioreria offre. */
  readonly careFrequencies: readonly CareFrequency[];
  readonly buyer: {
    readonly name: string;
    readonly phone: string | null;
    readonly addresses: readonly BuyerAddressDto[];
  };
  /** Richieste aperte di questa persona in questa fioreria; il modulo avvisa al limite. */
  readonly openCount: number;
}

/** Tutto ciò che serve al modulo della richiesta; null se il servizio non è in vetrina. */
export async function getServiceRequestForm(
  buyer: BuyerContext,
  slug: unknown,
  serviceId: unknown,
): Promise<ServiceRequestFormDto | null> {
  assertBuyer(buyer);
  if (!isUuid(serviceId)) return null;
  const tenantId = await publishedTenantId(slug);
  if (!tenantId) return null;
  return withTenantContext(getDb(), { tenantId, userId: buyer.userId }, async (tx) => {
    const service = await readPublishedServiceTx(tx, tenantId, serviceId);
    if (!service) return null;
    const [tenant, windows, care, user, profile, addresses, openCount] = await Promise.all([
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          slug: true,
          displayName: true,
          defaultLocale: true,
          currency: true,
          timezone: true,
          deliveryClosedWeekdays: true,
        },
      }),
      tx.deliveryWindow.findMany({
        where: { tenantId },
        orderBy: [{ startMinutes: 'asc' }, { endMinutes: 'asc' }],
        select: { startMinutes: true, endMinutes: true },
      }),
      service.kind === 'CARE' ? loadCareSettings(tx, tenantId) : Promise.resolve(null),
      tx.user.findUniqueOrThrow({ where: { id: buyer.userId }, select: { name: true } }),
      tx.buyerProfile.findUnique({ where: { userId: buyer.userId }, select: { phone: true } }),
      tx.buyerAddress.findMany({
        where: { userId: buyer.userId, status: 'ACTIVE' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          label: true,
          recipientName: true,
          recipientPhone: true,
          addressLine1: true,
          addressLine2: true,
          neighborhood: true,
          city: true,
          region: true,
          postalCode: true,
          deliveryNotes: true,
          isDefault: true,
          placeId: true,
        },
      }),
      tx.serviceRequest.count({
        where: { tenantId, buyerUserId: buyer.userId, status: { in: [...OPEN_STATUSES] } },
      }),
    ]);
    const today = todayInTimeZone(tenant.timezone);
    return {
      store: {
        slug: tenant.slug,
        name: tenant.displayName,
        locale: resolveLocale(tenant.defaultLocale),
        currency: tenant.currency,
      },
      service: {
        id: service.id,
        kind: service.kind,
        name: service.name,
        askDate: service.askDate,
        askAddress: service.askAddress,
      },
      needsAddress: serviceRequestNeedsAddress(service),
      minDate: toIsoDate(addDays(today, 1)),
      maxDate: toIsoDate(addMonths(today, SERVICE_REQUEST_LIMITS.monthsAhead)),
      windows: windows.map((window) => ({
        start: formatTimeOfDay(window.startMinutes),
        end: formatTimeOfDay(window.endMinutes),
      })),
      closedWeekdays: tenant.deliveryClosedWeekdays,
      careFrequencies: (care?.frequencies ?? []) as CareFrequency[],
      buyer: { name: user.name, phone: profile?.phone ?? null, addresses },
      openCount,
    };
  });
}

// -----------------------------------------------------------------------------
// L'invio
// -----------------------------------------------------------------------------

export interface SubmitServiceRequestOptions {
  /** Chi compra è arrivato dalla ricerca di Gardelia (origine del cliente nel CRM, D-24). */
  readonly fromSearch: boolean;
  readonly request?: RequestMeta;
}

export interface SubmittedServiceRequestDto {
  readonly requestId: string;
  readonly numberLabel: string;
  /** Lo stesso invio era già arrivato (doppio clic, rete lenta): nessuna richiesta nuova. */
  readonly duplicate: boolean;
}

function formFields(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Le foto di ispirazione, ricodificate senza EXIF, con le chiavi della richiesta. */
async function preparePhotos(tenantId: string, requestId: string, photos: readonly Uint8Array[]) {
  const files: FileToStore[] = [];
  const rows: {
    id: string;
    photoKey: string;
    photoThumbKey: string;
    photoWidth: number;
    photoHeight: number;
    sortOrder: number;
  }[] = [];
  for (const [index, bytes] of photos.entries()) {
    // L'errore va sul campo delle foto del modulo.
    const image = await normalizeUploadedPhoto(bytes, 'photos');
    const id = newId();
    const photoKey = `tenants/${tenantId}/service-requests/${requestId}-${id}.jpg`;
    const photoThumbKey = `tenants/${tenantId}/service-requests/${requestId}-${id}-thumb.jpg`;
    files.push(
      { key: photoKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: photoThumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    );
    rows.push({
      id,
      photoKey,
      photoThumbKey,
      photoWidth: image.full.width,
      photoHeight: image.full.height,
      sortOrder: index,
    });
  }
  return { files, rows };
}

/**
 * «Enviar solicitud». La richiesta entra nella fioreria «Nuova», con il cliente del CRM collegato
 * (stessa email) o creato; chi compra e la fioreria ricevono un'email dopo il commit.
 */
export async function submitServiceRequest(
  buyer: BuyerContext,
  slug: unknown,
  serviceId: unknown,
  rawInput: unknown,
  photos: readonly Uint8Array[],
  options: SubmitServiceRequestOptions,
  deps: OrderMailDeps | null,
): Promise<SubmittedServiceRequestDto> {
  assertBuyer(buyer);
  const raw = formFields(rawInput);
  const files = photos.filter((photo) => photo.byteLength > 0);
  if (files.length > SERVICE_REQUEST_LIMITS.photos) {
    throw new ValidationError({ photos: 'too_many_photos' });
  }
  if (!isUuid(serviceId)) throw new NotFoundError('StorefrontService');
  const tenantId = await publishedTenantId(slug);
  if (!tenantId) throw new NotFoundError('OnlineStore');
  const scope = { tenantId, userId: buyer.userId };

  // Prima un controllo veloce (servizio, schema, doppio invio): una richiesta sbagliata non
  // elabora né carica le foto.
  const precheck = await withTenantContext(getDb(), scope, async (tx) => {
    const service = await readPublishedServiceTx(tx, tenantId, serviceId);
    if (!service) throw new ConflictError('service_unavailable');
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });
    const parsed = serviceRequestSchema(
      service,
      buyer.country,
      tenant.currency as CurrencyCode,
    ).safeParse(raw);
    if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
    const input = parsed.data;
    let newAddress: ServiceRequestAddressInput | null = null;
    const buyerAddressId = 'buyerAddressId' in input ? input.buyerAddressId : null;
    if (serviceRequestNeedsAddress(service) && !buyerAddressId) {
      const address = serviceRequestAddressSchema(buyer.country).safeParse(raw);
      if (!address.success) throw new ValidationError(toFieldErrors(address.error));
      newAddress = address.data;
    }
    const existing = await tx.serviceRequest.findFirst({
      where: { tenantId, buyerUserId: buyer.userId, submitKey: input.submitKey },
      select: { id: true, number: true },
    });
    return { service, input, newAddress, buyerAddressId, existing };
  });
  if (precheck.existing) {
    return {
      requestId: precheck.existing.id,
      numberLabel: formatServiceRequestNumber(precheck.existing.number),
      duplicate: true,
    };
  }
  const { service, input, newAddress, buyerAddressId } = precheck;

  const requestId = newId();
  const prepared = await preparePhotos(tenantId, requestId, files);
  const commit = () =>
    withTenantContext(getDb(), scope, async (tx) => {
      // Una richiesta alla volta per persona e fioreria: il limite delle aperte regge anche a due
      // invii insieme.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`service-request:${tenantId}:${buyer.userId}`}))`;
      const existing = await tx.serviceRequest.findFirst({
        where: { tenantId, buyerUserId: buyer.userId, submitKey: input.submitKey },
        select: { id: true, number: true },
      });
      if (existing) {
        return { id: existing.id, number: existing.number, duplicate: true, mails: [] };
      }
      // Il servizio si rilegge sotto il lock: spento o archiviato nel frattempo = non disponibile.
      const current = await readPublishedServiceTx(tx, tenantId, service.id);
      const [tenant, user, openRequests] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { timezone: true, currency: true, deliveryClosedWeekdays: true },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: buyer.userId },
          select: { name: true, email: true },
        }),
        tx.serviceRequest.count({
          where: { tenantId, buyerUserId: buyer.userId, status: { in: [...OPEN_STATUSES] } },
        }),
      ]);
      const problem = serviceRequestProblem({
        available: current !== null,
        kind: service.kind,
        careReady: service.kind === 'CARE' ? await careOfferReadyTx(tx, tenantId) : true,
        openRequests,
      });
      if (problem) throw new ConflictError(problem);

      const date = 'date' in input ? input.date : null;
      const dateProblem = serviceRequestDateProblem(date, todayInTimeZone(tenant.timezone));
      if (dateProblem) throw new ValidationError({ date: dateProblem });

      if (input.kind === 'CARE') {
        const care = await loadCareSettings(tx, tenantId);
        if (!care?.frequencies.includes(input.frequency)) {
          throw new ValidationError({ frequency: 'invalid_option' });
        }
      }
      if (input.kind === 'WEEKLY') {
        if (tenant.deliveryClosedWeekdays.includes(input.weekday)) {
          throw new ValidationError({ weekday: 'invalid_option' });
        }
        // Una fascia scelta deve essere una di quelle della fioreria; vuota = qualsiasi ora.
        if (input.window) {
          const window = await tx.deliveryWindow.findFirst({
            where: { tenantId, startMinutes: input.window.start, endMinutes: input.window.end },
            select: { id: true },
          });
          if (!window) throw new ValidationError({ window: 'invalid_option' });
        }
      }

      // L'indirizzo COPIATO nella richiesta: da «Mi cuenta» o nuovo.
      let address: {
        addressLine1: string;
        addressLine2: string | null;
        neighborhood: string | null;
        city: string;
        region: string;
        postalCode: string;
        deliveryNotes: string | null;
      } | null = null;
      if (serviceRequestNeedsAddress(service)) {
        if (buyerAddressId) {
          const saved = await tx.buyerAddress.findFirst({
            where: { id: buyerAddressId, userId: buyer.userId, status: 'ACTIVE' },
          });
          if (!saved) throw new ValidationError({ buyerAddressId: 'invalid_option' });
          address = saved;
        } else {
          address = newAddress;
        }
      }

      // Cliente del CRM della fioreria: quello con la stessa email, o uno nuovo (il telefono si
      // scrive su chi non ne aveva uno, come per gli ordini online).
      const crm = await linkBuyerCustomerTx(tx, {
        tenantId,
        user,
        contactPhone: input.contactPhone,
        fromSearch: options.fromSearch,
      });
      const number = await nextTenantCounter(tx, tenantId, 'service_request');
      await tx.serviceRequest.create({
        data: {
          id: requestId,
          tenantId,
          number,
          serviceId: service.id,
          kind: service.kind,
          status: 'NEW',
          buyerUserId: buyer.userId,
          customerId: crm.customerId,
          preferredDate: date ? partsToDate(date) : null,
          addressLine1: address?.addressLine1 ?? null,
          addressLine2: address?.addressLine2 ?? null,
          neighborhood: address?.neighborhood ?? null,
          city: address?.city ?? null,
          region: address?.region ?? null,
          postalCode: address?.postalCode ?? null,
          addressNotes: address?.deliveryNotes ?? null,
          currency: tenant.currency,
          budgetMinor: 'budget' in input ? input.budget : null,
          contactPhone: input.contactPhone,
          message: input.message,
          answers: serviceRequestAnswers(input),
          submitKey: input.submitKey,
        },
      });
      if (prepared.rows.length > 0) {
        await tx.serviceRequestPhoto.createMany({
          data: prepared.rows.map((row) => ({ ...row, tenantId, requestId })),
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: buyer.userId,
          action: AUDIT_ACTIONS.serviceRequestSubmitted,
          entityType: 'ServiceRequest',
          entityId: requestId,
          metadata: {
            number: formatServiceRequestNumber(number),
            kind: service.kind,
            photos: prepared.rows.length,
            source: crm.acquisitionSource,
            newCustomer: crm.created,
            customerPhoneAdded: crm.phoneAdded,
            // Versione dei termini e dell'aviso accettati inviando la richiesta (ADR-068).
            termsVersion: LEGAL_VERSION,
          },
          requestId: options.request?.requestId ?? null,
          ipAddress: options.request?.ipAddress ?? null,
        },
      });
      // Il telefono di chi compra resta nel suo profilo per la prossima volta.
      await tx.$executeRaw`INSERT INTO "BuyerProfile" ("userId", "phone", "updatedAt")
      VALUES (${buyer.userId}::uuid, ${input.contactPhone}, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId") DO UPDATE SET "phone" = EXCLUDED."phone", "updatedAt" = CURRENT_TIMESTAMP`;
      const mails = deps
        ? [
            await buyerServiceRequestMailTx(tx, tenantId, requestId, 'received', deps),
            ...(await shopServiceRequestMailsTx(tx, tenantId, requestId, 'new', deps)),
          ].filter((mail) => mail !== null)
        : [];
      return { id: requestId, number, duplicate: false, mails };
    });

  const saved =
    prepared.files.length > 0 ? await storeFilesThenCommit(prepared.files, commit) : await commit();
  if (!saved) throw new NotFoundError('ServiceRequest');
  if (saved.duplicate && prepared.files.length > 0) {
    await deleteUnusedFiles(prepared.files.map((file) => file.key));
  }
  if (!saved.duplicate) logger.info({ tenantId, requestId }, 'richiesta di un servizio ricevuta');
  if (deps && saved.mails.length > 0) await sendOrderMails(deps.mailer, saved.mails);
  return {
    requestId: saved.id,
    numberLabel: formatServiceRequestNumber(saved.number),
    duplicate: saved.duplicate,
  };
}

// -----------------------------------------------------------------------------
// «Mis solicitudes» e la pagina della richiesta
// -----------------------------------------------------------------------------

export interface BuyerServiceRequestDto {
  readonly id: string;
  readonly shop: { readonly slug: string; readonly name: string; readonly active: boolean };
  readonly numberLabel: string;
  readonly kind: StorefrontServiceKind;
  /** Solo i servizi della fioreria; i predefiniti hanno il nome dalla lingua. */
  readonly serviceName: string | null;
  readonly status: ServiceRequestStatus;
  readonly preferredDate: string | null;
  readonly createdAt: Date;
}

/** Le richieste della persona in tutte le fiorerie (le 100 più recenti). */
export async function listBuyerServiceRequests(
  buyer: BuyerContext,
): Promise<BuyerServiceRequestDto[]> {
  assertBuyer(buyer);
  const rows = await withUserContext(
    getDb(),
    buyer.userId,
    (tx) =>
      tx.$queryRaw<
        {
          request_id: string;
          shop_slug: string;
          shop_name: string;
          shop_active: boolean;
          number: number;
          kind: string;
          service_name: string | null;
          status: string;
          preferred_date: Date | null;
          created_at: Date;
        }[]
      >`SELECT * FROM app_buyer_service_requests()`,
  );
  return rows.map((row) => ({
    id: row.request_id,
    shop: { slug: row.shop_slug, name: row.shop_name, active: row.shop_active },
    numberLabel: formatServiceRequestNumber(row.number),
    kind: row.kind as StorefrontServiceKind,
    serviceName: row.service_name,
    status: row.status as ServiceRequestStatus,
    preferredDate: isoDate(row.preferred_date),
    createdAt: row.created_at,
  }));
}

export interface BuyerServiceRequestDetailDto {
  readonly shop: BuyerRequestShop;
  readonly request: ServiceRequestDetailDto;
  readonly canCancel: boolean;
}

/** La pagina della richiesta nel conto di chi l'ha fatta. */
export async function getBuyerServiceRequest(
  buyer: BuyerContext,
  requestId: string,
): Promise<BuyerServiceRequestDetailDto> {
  return withBuyerRequest(buyer, requestId, async (tx, { shop, request }) => {
    const row = await tx.serviceRequest.findFirstOrThrow({
      where: { tenantId: shop.tenantId, id: request.id },
      select: serviceRequestSelect,
    });
    const dto = toServiceRequestDto(row);
    return { shop, request: dto, canCancel: canBuyerCancelServiceRequest(dto.status) };
  });
}

/** «Cancelar solicitud» finché è aperta; la fioreria riceve un'email dopo il commit. */
export async function cancelBuyerServiceRequest(
  buyer: BuyerContext,
  requestId: string,
  deps: OrderMailDeps | null,
): Promise<void> {
  const result = await withBuyerRequest(
    buyer,
    requestId,
    async (tx, { shop, request }) => {
      if (!canBuyerCancelServiceRequest(request.status as ServiceRequestStatus)) {
        throw new ConflictError('service_request_closed');
      }
      await tx.serviceRequest.update({
        where: { id: request.id, tenantId: shop.tenantId },
        data: { status: 'CANCELLED', statusChangedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: shop.tenantId,
          actorUserId: buyer.userId,
          action: AUDIT_ACTIONS.serviceRequestCancelledByBuyer,
          entityType: 'ServiceRequest',
          entityId: request.id,
          metadata: { number: formatServiceRequestNumber(request.number) },
        },
      });
      const mails = deps
        ? await shopServiceRequestMailsTx(tx, shop.tenantId, request.id, 'cancelled', deps)
        : [];
      return { tenantId: shop.tenantId, mails };
    },
    { lock: true },
  );
  logger.info({ tenantId: result.tenantId, requestId }, "richiesta annullata da chi l'ha fatta");
  if (deps && result.mails.length > 0) await sendOrderMails(deps.mailer, result.mails);
}

/** Una foto di ispirazione della propria richiesta (finché i file ci sono). */
export async function getBuyerServiceRequestPhoto(
  buyer: BuyerContext,
  requestId: string,
  photoId: string,
  size: 'full' | 'thumb',
): Promise<StoredImage> {
  if (!isUuid(photoId)) throw new NotFoundError('ServiceRequestPhoto');
  const photo = await withBuyerRequest(buyer, requestId, (tx, { shop, request }) =>
    tx.serviceRequestPhoto.findFirst({
      where: { tenantId: shop.tenantId, requestId: request.id, id: photoId, photoDeletedAt: null },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!photo) throw new NotFoundError('ServiceRequestPhoto');
  return readStoredImage(
    size === 'thumb' ? photo.photoThumbKey : photo.photoKey,
    'image/jpeg',
    'ServiceRequestPhoto',
  );
}
