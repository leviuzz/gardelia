/**
 * "Mi tienda en línea" (marketplace, blocco C2, ADR-065): impostazioni della pagina pubblica della
 * fioreria. Si pubblica solo con almeno un prodotto visibile e il telefono di contatto (fino agli
 * ordini online, C4, il cliente scrive alla fioreria). I pagamenti restano diretti: qui ci sono
 * solo le informazioni da mostrare.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ONLINE_ITEM_TYPES,
  isStoreImageKind,
  newId,
  onlineStoreFormSchema,
  storePublishBlockers,
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
}

async function readState(tx: TransactionClient, ctx: TenantContext) {
  const [store, onlineItems, tenant] = await Promise.all([
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
  ]);
  return { store, onlineItems, contactPhone: tenant.contactPhone };
}

export async function getOnlineStoreSettings(ctx: TenantContext): Promise<OnlineStoreSettingsDto> {
  requirePermission(ctx, 'tenant:read');
  const { store, onlineItems, contactPhone } = await withTenantContext(getDb(), ctx, (tx) =>
    readState(tx, ctx),
  );
  return {
    isPublished: store?.isPublished ?? false,
    publishedAt: store?.publishedAt ?? null,
    description: store?.description ?? null,
    paymentMethods: (store?.paymentMethods ?? []) as StorePaymentMethod[],
    paymentInstructions: store?.paymentInstructions ?? null,
    onlineItems,
    blockers: storePublishBlockers({ onlineItems, contactPhone }),
    logoId: store?.logoId ?? null,
    coverId: store?.coverId ?? null,
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
