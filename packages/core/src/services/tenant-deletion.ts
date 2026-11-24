/**
 * "Eliminar florería" (ADR-074, deciso dal founder il 24/11/2026). Il titolare chiede l'eliminazione:
 * la fioreria diventa ARCHIVED e sparisce per tutti (squadra, clienti, tienda en línea, link), i
 * titolari ricevono un'email. Per 30 giorni il titolare la recupera; poi la manutenzione giornaliera
 * cancella i file dall'archivio e la fioreria con tutti i suoi dati (cascata nel database). Resta solo
 * un evento di piattaforma senza dati personali.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  TENANT_DELETION,
  tenantDeleteAfter,
  tenantDeletionBlockers,
  tenantDeletionSchema,
  toFieldErrors,
  type TenantDeletionBlocker,
} from '@floral/domain';
import { getObjectStorage } from '../ai/storage';
import { recordAudit, recordPlatformSecurityEvent } from '../audit';
import { requirePermission } from '../authorization';
import { resolveTenantContextForRestore, type RequestMeta, type TenantContext } from '../context';
import { tenantDeletionScheduledEmail } from '../email-templates';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Mailer } from '../mailer';

/** Stati in cui un ordine conta come in corso (gli altri non bloccano). */
const OPEN_ORDER_STATUSES = [
  'PENDING_ACCEPTANCE',
  'CONFIRMED',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
] as const;

export interface TenantDeletionOverviewDto {
  readonly blockers: readonly TenantDeletionBlocker[];
  /** Ordini ancora da consegnare o ritirare. */
  readonly openOrders: number;
  readonly graceDays: number;
  /** Il giorno della cancellazione definitiva se si chiede adesso. */
  readonly deleteAfterIfNow: Date;
}

/** Pagina "Eliminar florería": cosa la blocca e quando si cancellerebbe. */
export async function getTenantDeletionOverview(
  ctx: TenantContext,
): Promise<TenantDeletionOverviewDto> {
  requirePermission(ctx, 'tenant:delete');
  const openOrders = await withTenantContext(getDb(), ctx, (tx) =>
    tx.order.count({
      where: { tenantId: ctx.tenantId, status: { in: [...OPEN_ORDER_STATUSES] } },
    }),
  );
  return {
    blockers: openOrders > 0 ? ['tenant_deletion_open_orders'] : [],
    openOrders,
    graceDays: TENANT_DELETION.graceDays,
    deleteAfterIfNow: tenantDeleteAfter(new Date()),
  };
}

export interface TenantDeletionMailDeps {
  readonly mailer: Mailer;
  /** Dove si recupera la fioreria (la scelta della fioreria, `/app`). */
  readonly restoreUrl: string;
}

/**
 * Programma l'eliminazione: solo il titolare, scrivendo il nome della fioreria, senza ordini in
 * corso. Dopo questa chiamata il contesto della fioreria non si risolve più (404 per tutti).
 */
export async function requestTenantDeletion(
  ctx: TenantContext,
  raw: unknown,
  mail: TenantDeletionMailDeps | null,
): Promise<{ readonly deleteAfter: Date }> {
  requirePermission(ctx, 'tenant:delete');
  const parsed = tenantDeletionSchema(ctx.tenantName).safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));

  const now = new Date();
  const deleteAfter = tenantDeleteAfter(now);
  const owners = await withTenantContext(getDb(), ctx, async (tx) => {
    // Un ordine creato nello stesso istante non sfugge al controllo.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${ctx.tenantId}::uuid FOR UPDATE`;
    const orders = await tx.order.findMany({
      where: { tenantId: ctx.tenantId, status: { in: [...OPEN_ORDER_STATUSES] } },
      select: { status: true },
      take: 1,
    });
    const blockers = tenantDeletionBlockers({ orderStatuses: orders.map((o) => o.status) });
    if (blockers[0]) throw new ConflictError(blockers[0]);

    await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        status: 'ARCHIVED',
        deletionRequestedAt: now,
        deletionRequestedById: ctx.userId,
        deleteAfter,
      },
    });
    // La tienda si spegne subito: nessuno può più ordinare a una fioreria che sparisce.
    await tx.onlineStore.updateMany({
      where: { tenantId: ctx.tenantId },
      data: { isPublished: false, ordersEnabled: false },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantDeletionRequested,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: { deleteAfter: deleteAfter.toISOString() },
    });
    return tx.membership.findMany({
      where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE' },
      select: { user: { select: { email: true, name: true } } },
    });
  });
  logger.info({ tenantId: ctx.tenantId }, 'eliminazione della fioreria programmata');

  if (mail) {
    const deleteOn = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeZone: ctx.timezone,
    }).format(deleteAfter);
    for (const { user } of owners) {
      try {
        await mail.mailer.send(
          tenantDeletionScheduledEmail({
            to: user.email,
            name: user.name,
            tenantName: ctx.tenantName,
            deleteOn,
            url: mail.restoreUrl,
          }),
        );
      } catch (error) {
        // L'eliminazione è già programmata: un'email non partita non la deve annullare.
        logger.warn({ err: error, tenantId: ctx.tenantId }, 'email di eliminazione non inviata');
      }
    }
  }
  return { deleteAfter };
}

/**
 * "Recuperar": il titolare riporta la fioreria com'era prima della richiesta, finché la data non è
 * passata. La tienda resta spenta: si ripubblica dalle impostazioni, quando si vuole.
 */
export async function restoreTenant(input: {
  readonly userId: string;
  readonly slug: string;
  readonly request?: RequestMeta;
}): Promise<{ readonly slug: string }> {
  const ctx = await resolveTenantContextForRestore(input);
  if (!ctx) throw new NotFoundError('Tenant');
  requirePermission(ctx, 'tenant:delete');
  const restored = await withTenantContext(getDb(), ctx, async (tx) => {
    const result = await tx.tenant.updateMany({
      where: {
        id: ctx.tenantId,
        status: 'ARCHIVED',
        deleteAfter: { not: null, gt: new Date() },
      },
      data: {
        status: 'ACTIVE',
        deletionRequestedAt: null,
        deletionRequestedById: null,
        deleteAfter: null,
      },
    });
    if (result.count !== 1) return false;
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.tenantDeletionCancelled,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
    });
    return true;
  });
  if (!restored) throw new NotFoundError('Tenant');
  logger.info({ tenantId: ctx.tenantId }, 'eliminazione della fioreria annullata');
  return { slug: ctx.tenantSlug };
}

/**
 * Manutenzione giornaliera: cancella davvero le fiorerie con la data passata. Prima i file
 * dell'archivio (foto del catalogo, dei ramos, prove di consegna, anteprime AI, logo e copertina),
 * poi la fioreria con tutti i suoi dati. Se l'archivio non risponde, la fioreria resta e si riprova
 * il giorno dopo: nessun file rimane senza padrone.
 */
export async function purgeDeletedTenants(): Promise<number> {
  const due = await getDb().$queryRaw<{ tenant_id: string }[]>`
    SELECT tenant_id FROM app_tenants_to_purge(${TENANT_DELETION.purgePerRun})`;
  let purged = 0;
  for (const { tenant_id: tenantId } of due) {
    const scope = { tenantId, userId: null };
    const found = await withTenantContext(getDb(), scope, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { deletionRequestedById: true, deletionRequestedAt: true },
      });
      if (!tenant) return null;
      const where = { tenantId };
      const [store, aiJobs, bouquetPhotos, catalogPhotos, styleReferences, orderPhotos] =
        await Promise.all([
          tx.onlineStore.findMany({ where, select: { logoKey: true, coverKey: true } }),
          tx.aiJob.findMany({ where, select: { outputKey: true } }),
          tx.bouquetPhoto.findMany({ where, select: { storageKey: true, thumbKey: true } }),
          tx.catalogItemPhoto.findMany({
            where,
            select: { storageKey: true, thumbKey: true, cutoutKey: true },
          }),
          tx.styleReferencePhoto.findMany({ where, select: { storageKey: true, thumbKey: true } }),
          tx.orderPhoto.findMany({ where, select: { storageKey: true, thumbKey: true } }),
        ]);
      const keys = [
        ...store.flatMap((row) => [row.logoKey, row.coverKey]),
        ...aiJobs.map((row) => row.outputKey),
        ...[...bouquetPhotos, ...styleReferences, ...orderPhotos].flatMap((row) => [
          row.storageKey,
          row.thumbKey,
        ]),
        ...catalogPhotos.flatMap((row) => [row.storageKey, row.thumbKey, row.cutoutKey]),
      ].filter((key): key is string => typeof key === 'string' && key !== '');
      return { ...tenant, keys: [...new Set(keys)] };
    });
    if (!found) continue;

    try {
      const storage = getObjectStorage();
      for (const key of found.keys) await storage.delete(key);
    } catch (error) {
      logger.warn(
        { err: error, tenantId },
        'fioreria non cancellata: archivio dei file non raggiungibile',
      );
      continue;
    }

    const rows = await getDb().$queryRaw<{ purged: boolean }[]>`
      SELECT app_purge_tenant(${tenantId}::uuid) AS purged`;
    if (!rows[0]?.purged) continue;
    purged += 1;
    await recordPlatformSecurityEvent({
      action: AUDIT_ACTIONS.platformTenantPurged,
      actorUserId: found.deletionRequestedById,
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: {
        requestedAt: found.deletionRequestedAt?.toISOString() ?? null,
        files: found.keys.length,
      },
    });
    logger.info({ tenantId, files: found.keys.length }, 'fioreria cancellata definitivamente');
  }
  return purged;
}
