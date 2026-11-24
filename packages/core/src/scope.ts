/**
 * Chi scrive dentro una fioreria (ADR-074 §8): un membro, con il `TenantContext` che viene SOLO da
 * `resolveTenantContext`, oppure un lavoro automatico senza utente, con un `JobScope` che viene
 * SOLO da `loadJobScope` (rilegge la fioreria attiva dentro la transazione del lavoro).
 *
 * Le funzioni interne `…Tx` dei servizi che girano anche nei lavori (visite di Floral Care, poi
 * cargos, email e consegne periodiche) ricevono uno `WriteScope`: mai un TenantContext finto, mai
 * l'ID del proprietario al posto di "nessuno". Nel registro un lavoro scrive attore nullo e il suo
 * nome (`recordJobAudit`). Un test delle convenzioni vieta `as TenantContext` fuori da `context.ts`.
 */
import type { Prisma, TenantMode, TransactionClient } from '@floral/db';
import type { AuditAction } from '@floral/domain';
import { recordAudit } from './audit';
import type { TenantContext } from './context';

declare const jobScopeBrand: unique symbol;

/** Una fioreria vista da un lavoro automatico (manutenzione), senza utente. */
export interface JobScope {
  readonly [jobScopeBrand]: true;
  readonly tenantId: string;
  readonly timezone: string;
  readonly mode: TenantMode;
  /** Nome del lavoro, scritto nel registro: "care.visits.extend". */
  readonly job: string;
}

export type WriteScope =
  | { readonly kind: 'member'; readonly ctx: TenantContext }
  | { readonly kind: 'job'; readonly job: JobScope };

/**
 * Costruisce lo scope di un lavoro rileggendo la fioreria dentro la transazione già aperta con
 * `withTenantContext({ tenantId, userId: null })`. Null se la fioreria non è (più) attiva.
 */
export async function loadJobScope(
  tx: TransactionClient,
  tenantId: string,
  job: string,
): Promise<JobScope | null> {
  const tenant = await tx.tenant.findFirst({
    where: { id: tenantId, status: 'ACTIVE' },
    select: { id: true, timezone: true, mode: true },
  });
  if (!tenant) return null;
  const scope = { tenantId: tenant.id, timezone: tenant.timezone, mode: tenant.mode, job };
  return scope as JobScope;
}

export function memberScope(ctx: TenantContext): WriteScope {
  return { kind: 'member', ctx };
}

export function jobWriteScope(job: JobScope): WriteScope {
  return { kind: 'job', job };
}

export function scopeTenantId(scope: WriteScope): string {
  return scope.kind === 'member' ? scope.ctx.tenantId : scope.job.tenantId;
}

export function scopeTimezone(scope: WriteScope): string {
  return scope.kind === 'member' ? scope.ctx.timezone : scope.job.timezone;
}

/** L'utente che agisce, o null per un lavoro automatico. */
export function scopeUserId(scope: WriteScope): string | null {
  return scope.kind === 'member' ? scope.ctx.userId : null;
}

export interface ScopeAuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly metadata?: Prisma.InputJsonObject;
}

/** Registro di un lavoro: attore nullo, il nome del lavoro nei metadati, nessuna richiesta. */
export async function recordJobAudit(
  tx: TransactionClient,
  job: JobScope,
  entry: ScopeAuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: job.tenantId,
      actorUserId: null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: { ...entry.metadata, job: job.job },
    },
  });
}

/** Il registro giusto per chi agisce: `recordAudit` per un membro, `recordJobAudit` per un lavoro. */
export async function recordScopeAudit(
  tx: TransactionClient,
  scope: WriteScope,
  entry: ScopeAuditEntry,
): Promise<void> {
  if (scope.kind === 'member') {
    await recordAudit(tx, scope.ctx, {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    });
    return;
  }
  await recordJobAudit(tx, scope.job, entry);
}
