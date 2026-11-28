/**
 * "Mi tienda en línea" (marketplace, blocco C2, ADR-065): impostazioni della pagina pubblica della
 * fioreria. Si pubblica solo con almeno un prodotto visibile e il telefono di contatto. Gli ordini
 * online (C4, ADR-067) si accendono a parte e chiedono anche un modo di pagare. I pagamenti restano
 * diretti: qui ci sono solo le informazioni da mostrare.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ONLINE_ITEM_TYPES,
  deliveryFeeSummary,
  freshCoordinates,
  isStoreImageKind,
  newId,
  onlineOrderSettingsSchema,
  onlineOrdersBlockers,
  onlineStoreFormSchema,
  storePublishBlockers,
  storeReadiness,
  type OnlineOrdersBlocker,
  type StoreReadiness,
  toFieldErrors,
  type StoreImageKind,
  type StorePaymentMethod,
  type StorePublishBlocker,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit, type StoredImage } from '../media/stored-files';
import { awaitingShopWhere } from './order-payment-internals';

export interface OnlineStoreSettingsDto {
  readonly isPublished: boolean;
  readonly publishedAt: Date | null;
  readonly description: string | null;
  readonly paymentMethods: readonly StorePaymentMethod[];
  readonly paymentInstructions: string | null;
  /** Prodotti attivi con "Visible en línea". */
  readonly onlineItems: number;
  /** Cosa manca per pubblicare (vuoto = si può). */
  readonly blockers: readonly StorePublishBlocker[];
  /** ID delle immagini (cambiano a ogni sostituzione), o null. */
  readonly logoId: string | null;
  readonly coverId: string | null;
  /** Ordini online (ADR-067): accesi, anticipo minimo, cosa manca per accenderli. */
  readonly ordersEnabled: boolean;
  readonly minLeadDays: number;
  /**
   * «Anche lo staff può accettare e rifiutare gli ordini online» (M3-3): spento di default. Vale per
   * accettare, rifiutare, chiedere conferma, proporre una data e cambiare un ordine da accettare.
   */
  readonly staffCanAccept: boolean;
  readonly ordersBlockers: readonly OnlineOrdersBlocker[];
  /** Ordini online da accettare che aspettano la fioreria (senza quelli in attesa del cliente). */
  readonly pendingOrders: number;
  /** Politiche della fioreria (M1): cambi, cancellazioni, sostituzioni; null se non scritte. */
  readonly policies: {
    readonly policyChanges: string | null;
    readonly policyCancellations: string | null;
    readonly policySubstitutions: string | null;
  };
  /**
   * La sede principale ha la posizione di Google ancora valida: chi cerca per indirizzo trova la
   * tienda e le distanze si misurano da lì (ADR-066, ADR-069). Senza, la trova solo chi cerca la città.
   */
  readonly onMap: boolean;
  /** Prodotti online senza nessuna foto (M1-2): l'avviso e il filtro del Catalogo. */
  readonly onlineWithoutPhoto: number;
  /** «Completa la tua vetrina» (M1-2): i passi fatti e quelli da fare. */
  readonly readiness: StoreReadiness;
}

async function readState(tx: TransactionClient, ctx: TenantContext) {
  const [store, onlineItems, tenant, pendingOrders, location] = await Promise.all([
    tx.onlineStore.findUnique({ where: { tenantId: ctx.tenantId } }),
    tx.catalogItem.count({
      where: {
        tenantId: ctx.tenantId,
        isOnline: true,
        status: 'ACTIVE',
        type: { in: [...ONLINE_ITEM_TYPES] },
      },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { contactPhone: true },
    }),
    // Gli ordini da accettare che aspettano la fioreria: come il numero del menu (M3-2).
    tx.order.count({ where: { tenantId: ctx.tenantId, ...awaitingShopWhere() } }),
    tx.location.findFirst({
      where: { tenantId: ctx.tenantId, isPrimary: true },
      select: { latitude: true, longitude: true, coordinatesAt: true },
    }),
  ]);
  return {
    store,
    onlineItems,
    contactPhone: tenant.contactPhone,
    pendingOrders,
    onMap: location !== null && freshCoordinates(location, new Date()) !== null,
  };
}

/** I conteggi di «Completa la tua vetrina» che `readState` non ha già. */
async function readReadinessCounts(tx: TransactionClient, ctx: TenantContext) {
  const online = {
    tenantId: ctx.tenantId,
    isOnline: true,
    status: 'ACTIVE' as const,
    type: { in: [...ONLINE_ITEM_TYPES] },
  };
  const [onlineWithoutPhoto, featuredItems, tenant, feeTiers] = await Promise.all([
    tx.catalogItem.count({ where: { ...online, photos: { none: { status: 'ACTIVE' } } } }),
    tx.catalogItem.count({ where: { ...online, featuredAt: { not: null } } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { defaultDeliveryFeeMinor: true },
    }),
    tx.deliveryFeeTier.findMany({ where: { tenantId: ctx.tenantId }, select: { feeMinor: true } }),
  ]);
  const fee = deliveryFeeSummary({
    defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
    tierFeesMinor: feeTiers.map((tier) => tier.feeMinor),
  });
  return { onlineWithoutPhoto, featuredItems, hasDeliveryFee: fee.kind !== 'to_confirm' };
}

export async function getOnlineStoreSettings(ctx: TenantContext): Promise<OnlineStoreSettingsDto> {
  requirePermission(ctx, 'tenant:read');
  const [{ store, onlineItems, contactPhone, pendingOrders, onMap }, counts] =
    await withTenantContext(getDb(), ctx, (tx) =>
      Promise.all([readState(tx, ctx), readReadinessCounts(tx, ctx)]),
    );
  const paymentMethods = (store?.paymentMethods ?? []) as StorePaymentMethod[];
  const policies = {
    policyChanges: store?.policyChanges ?? null,
    policyCancellations: store?.policyCancellations ?? null,
    policySubstitutions: store?.policySubstitutions ?? null,
  };
  return {
    isPublished: store?.isPublished ?? false,
    publishedAt: store?.publishedAt ?? null,
    description: store?.description ?? null,
    paymentMethods,
    paymentInstructions: store?.paymentInstructions ?? null,
    onlineItems,
    blockers: storePublishBlockers({ onlineItems, contactPhone }),
    logoId: store?.logoId ?? null,
    coverId: store?.coverId ?? null,
    ordersEnabled: store?.ordersEnabled ?? false,
    minLeadDays: store?.minLeadDays ?? 1,
    staffCanAccept: store?.staffCanAccept ?? false,
    ordersBlockers: onlineOrdersBlockers({ paymentMethods, contactPhone }),
    pendingOrders,
    onMap,
    policies,
    onlineWithoutPhoto: counts.onlineWithoutPhoto,
    readiness: storeReadiness({
      hasLogo: Boolean(store?.logoId),
      hasCover: Boolean(store?.coverId),
      hasDescription: Boolean(store?.description?.trim()),
      onlineItems,
      onlineWithoutPhoto: counts.onlineWithoutPhoto,
      featuredItems: counts.featuredItems,
      hasDeliveryFee: counts.hasDeliveryFee,
      paymentMethods: paymentMethods.length,
      policies: Object.values(policies).filter((text) => text !== null).length,
    }),
  };
}

/** Crea la riga se manca (`ON CONFLICT`: due salvataggi contemporanei non si scontrano). */
async function ensureStore(tx: TransactionClient, ctx: TenantContext): Promise<void> {
  await tx.$executeRaw`INSERT INTO "OnlineStore" ("tenantId", "updatedAt")
    VALUES (${ctx.tenantId}::uuid, CURRENT_TIMESTAMP) ON CONFLICT ("tenantId") DO NOTHING`;
}

/** Descrizione e forme di pagamento mostrate sulla pagina pubblica. */
export async function updateOnlineStore(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = onlineStoreFormSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withTenantContext(getDb(), ctx, async (tx) => {
    await ensureStore(tx, ctx);
    const before = await tx.onlineStore.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    const changedFields = [
      before.description !== input.description ? 'description' : null,
      [...before.paymentMethods].sort().join() !== [...input.paymentMethods].sort().join()
        ? 'paymentMethods'
        : null,
      before.paymentInstructions !== input.paymentInstructions ? 'paymentInstructions' : null,
    ].filter((field): field is string => field !== null);
    if (changedFields.length === 0) return;
    // Con gli ordini online accesi, chi compra deve sapere come pagare.
    if (before.ordersEnabled && input.paymentMethods.length === 0) {
      throw new ValidationError({ paymentMethods: 'store_needs_payment' });
    }
    await tx.onlineStore.update({
      where: { tenantId: ctx.tenantId },
      data: {
        description: input.description,
        paymentMethods: [...input.paymentMethods],
        paymentInstructions: input.paymentInstructions,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storeUpdated,
      entityType: 'OnlineStore',
      entityId: ctx.tenantId,
      // Solo cosa è cambiato: i testi (anche i dati bancari) non vanno nel registro.
      metadata: { changedFields },
    });
  });
}

/**
 * "Pedidos en línea" (ADR-067): se chi compra può ordinare dalla pagina e con quanti giorni di
 * anticipo. Accenderli richiede un modo di pagare e il telefono; spegnerli non tocca gli ordini già
 * arrivati (si accettano o rifiutano come sempre). M3-3: anche se lo staff li può accettare.
 */
export async function updateOnlineOrderSettings(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = onlineOrderSettingsSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withTenantContext(getDb(), ctx, async (tx) => {
    await ensureStore(tx, ctx);
    await tx.$queryRaw`SELECT "tenantId" FROM "OnlineStore" WHERE "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    const { store, contactPhone } = await readState(tx, ctx);
    if (!store) return;
    if (
      store.ordersEnabled === input.ordersEnabled &&
      store.minLeadDays === input.minLeadDays &&
      store.staffCanAccept === input.staffCanAccept
    ) {
      return;
    }
    if (input.ordersEnabled && !store.ordersEnabled) {
      const [blocker] = onlineOrdersBlockers({
        paymentMethods: store.paymentMethods,
        contactPhone,
      });
      if (blocker) throw new ConflictError(blocker);
    }
    await tx.onlineStore.update({
      where: { tenantId: ctx.tenantId },
      data: {
        ordersEnabled: input.ordersEnabled,
        minLeadDays: input.minLeadDays,
        staffCanAccept: input.staffCanAccept,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storeOrdersUpdated,
      entityType: 'OnlineStore',
      entityId: ctx.tenantId,
      metadata: {
        changes: {
          ...(store.ordersEnabled !== input.ordersEnabled
            ? { ordersEnabled: { from: store.ordersEnabled, to: input.ordersEnabled } }
            : {}),
          ...(store.minLeadDays !== input.minLeadDays
            ? { minLeadDays: { from: store.minLeadDays, to: input.minLeadDays } }
            : {}),
          ...(store.staffCanAccept !== input.staffCanAccept
            ? { staffCanAccept: { from: store.staffCanAccept, to: input.staffCanAccept } }
            : {}),
        },
      },
    });
  });
}

/** Pubblica o ritira la pagina. Pubblicare richiede prodotti visibili e il telefono. */
export async function setOnlineStorePublished(ctx: TenantContext, publish: boolean): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  await withTenantContext(getDb(), ctx, async (tx) => {
    await ensureStore(tx, ctx);
    // Una richiesta alla volta per fioreria (pubblica/ritira contemporanei).
    await tx.$queryRaw`SELECT "tenantId" FROM "OnlineStore" WHERE "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    const { store, onlineItems, contactPhone } = await readState(tx, ctx);
    if (!store || store.isPublished === publish) return;
    if (publish) {
      const [blocker] = storePublishBlockers({ onlineItems, contactPhone });
      if (blocker) throw new ConflictError(blocker);
    }
    await tx.onlineStore.update({
      where: { tenantId: ctx.tenantId },
      data: publish ? { isPublished: true, publishedAt: new Date() } : { isPublished: false },
    });
    await recordAudit(tx, ctx, {
      action: publish ? AUDIT_ACTIONS.storePublished : AUDIT_ACTIONS.storeUnpublished,
      entityType: 'OnlineStore',
      entityId: ctx.tenantId,
      metadata: { onlineItems },
    });
  });
}

function checkKind(kind: unknown): StoreImageKind {
  if (!isStoreImageKind(kind)) throw new ValidationError({ kind: 'invalid_option' });
  return kind;
}

const IMAGE_COLUMNS = {
  LOGO: { id: 'logoId', key: 'logoKey' },
  COVER: { id: 'coverId', key: 'coverKey' },
} as const;

/**
 * Carica (o sostituisce) il logo o la foto di copertina. Il logo si salva piccolo (miniatura), la
 * copertina grande. I file si salvano PRIMA della transazione e si tolgono se non va a buon fine;
 * quelli sostituiti restano nell'archivio (nessuna cancellazione fisica, come le foto del catalogo).
 */
export async function setStoreImage(
  ctx: TenantContext,
  rawKind: unknown,
  file: Uint8Array,
): Promise<{ readonly id: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  const kind = checkKind(rawKind);
  const image = await normalizeUploadedPhoto(file);
  const id = newId();
  const key = `tenants/${ctx.tenantId}/store/${kind === 'LOGO' ? 'logo' : 'cover'}-${id}.jpg`;
  const version = kind === 'LOGO' ? image.thumb : image.full;
  const columns = IMAGE_COLUMNS[kind];
  await storeFilesThenCommit(
    [{ key, bytes: version.bytes, contentType: version.contentType }],
    () =>
      withTenantContext(getDb(), ctx, async (tx) => {
        await ensureStore(tx, ctx);
        await tx.onlineStore.update({
          where: { tenantId: ctx.tenantId },
          data: { [columns.id]: id, [columns.key]: key },
        });
        await recordAudit(tx, ctx, {
          action: AUDIT_ACTIONS.storeImageSet,
          entityType: 'OnlineStore',
          entityId: ctx.tenantId,
          metadata: { kind, imageId: id },
        });
        return true;
      }),
  );
  return { id };
}

/** Toglie il logo o la copertina dalla pagina. */
export async function removeStoreImage(ctx: TenantContext, rawKind: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const kind = checkKind(rawKind);
  const columns = IMAGE_COLUMNS[kind];
  await withTenantContext(getDb(), ctx, async (tx) => {
    const store = await tx.onlineStore.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!store?.[columns.id]) return;
    await tx.onlineStore.update({
      where: { tenantId: ctx.tenantId },
      data: { [columns.id]: null, [columns.key]: null },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storeImageRemoved,
      entityType: 'OnlineStore',
      entityId: ctx.tenantId,
      metadata: { kind },
    });
  });
}

/** L'immagine per l'anteprima nelle impostazioni (anche con la tienda non pubblicata). */
export async function getStoreImage(ctx: TenantContext, rawKind: unknown): Promise<StoredImage> {
  requirePermission(ctx, 'tenant:read');
  const kind = checkKind(rawKind);
  const store = await withTenantContext(getDb(), ctx, (tx) =>
    tx.onlineStore.findUnique({ where: { tenantId: ctx.tenantId } }),
  );
  const key = store?.[IMAGE_COLUMNS[kind].key];
  if (!key) throw new NotFoundError('OnlineStore');
  return readStoredImage(key, 'image/jpeg', 'OnlineStore');
}
