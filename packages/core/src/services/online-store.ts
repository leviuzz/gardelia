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
  onlineStoreFormSchema,
  storePublishBlockers,
  toFieldErrors,
  type StorePaymentMethod,
  type StorePublishBlocker,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, ValidationError } from '../errors';

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
