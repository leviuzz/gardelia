/**
 * Avvisi della squadra per chi gestisce (ADR-076): una pianta morta da reponer (creato anche da
 * solo a "Terminar visita"), un lavoro extra chiesto dal cliente, altro. Li scrive chi fa la
 * visita (`care:visit`, anche lo staff); li vede tutta la squadra e li segna come attesi solo chi
 * gestisce i contratti. Non si cancellano mai.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  careFollowUpResolveSchema,
  formatSubscriptionNumber,
  isUuid,
  toFieldErrors,
  type CareFollowUpKind,
  type CareFollowUpStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { isoOf } from './care-internals';

export interface CareFollowUpDto {
  readonly id: string;
  readonly kind: CareFollowUpKind;
  readonly status: CareFollowUpStatus;
  readonly plantName: string | null;
  readonly quantity: number | null;
  readonly note: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly visitId: string;
  /** Giorno della visita da cui è nato ("AAAA-MM-GG"). */
  readonly visitDate: string | null;
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
}

export const followUpSelect = {
  id: true,
  kind: true,
  status: true,
  quantity: true,
  note: true,
  resolutionNote: true,
  createdAt: true,
  resolvedAt: true,
  visitId: true,
  subscriptionId: true,
  plant: { select: { name: true } },
  visit: { select: { scheduledDate: true } },
  subscription: { select: { number: true, customer: { select: { displayName: true } } } },
} satisfies Prisma.CareFollowUpSelect;

type FollowUpRow = Prisma.CareFollowUpGetPayload<{ select: typeof followUpSelect }>;

export function toFollowUpDto(row: FollowUpRow): CareFollowUpDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    plantName: row.plant?.name ?? null,
    quantity: row.quantity,
    note: row.note,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    visitId: row.visitId,
    visitDate: isoOf(row.visit.scheduledDate),
    subscriptionId: row.subscriptionId,
    numberLabel: formatSubscriptionNumber(row.subscription.number),
    customerName: row.subscription.customer.displayName,
  };
}

export interface CareFollowUpListDto {
  readonly items: readonly CareFollowUpDto[];
  /** Chi guarda può segnarli come attesi. */
  readonly canResolve: boolean;
}

/** Gli avvisi aperti (i più vecchi prima) o gli ultimi attesi. */
export async function listCareFollowUps(
  ctx: TenantContext,
  rawStatus: unknown,
): Promise<CareFollowUpListDto> {
  requirePermission(ctx, 'subscriptions:read');
  const status: CareFollowUpStatus = rawStatus === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const rows = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return tx.careFollowUp.findMany({
      where: { tenantId: ctx.tenantId, status },
      orderBy: status === 'OPEN' ? [{ createdAt: 'asc' }] : [{ resolvedAt: 'desc' }],
      take: 100,
      select: followUpSelect,
    });
  });
  return {
    items: rows.map(toFollowUpDto),
    canResolve: hasPermission(ctx, 'subscriptions:write'),
  };
}

/** Quanti avvisi aperti ha la fioreria (per l'avviso nell'Agenda); 0 senza il piano. */
export async function countOpenCareFollowUpsTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<number> {
  return tx.careFollowUp.count({ where: { tenantId, status: 'OPEN' } });
}

/** "Atendido": chi gestisce segna l'avviso come risolto, con una nota facoltativa. */
export async function resolveCareFollowUp(
  ctx: TenantContext,
  followUpId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(followUpId)) throw new NotFoundError('CareFollowUp');
  const parsed = careFollowUpResolveSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const followUp = await tx.careFollowUp.findFirst({
      where: { tenantId: ctx.tenantId, id: followUpId },
      select: { id: true, kind: true, status: true, subscription: { select: { number: true } } },
    });
    if (!followUp) return false;
    if (followUp.status === 'RESOLVED') return true;
    const updated = await tx.careFollowUp.updateMany({
      where: { tenantId: ctx.tenantId, id: followUp.id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: ctx.userId,
        resolutionNote: parsed.data.note,
      },
    });
    if (updated.count > 0) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.careFollowUpResolved,
        entityType: 'CareFollowUp',
        entityId: followUp.id,
        metadata: {
          number: formatSubscriptionNumber(followUp.subscription.number),
          kind: followUp.kind,
        },
      });
    }
    return true;
  });
  if (!found) await notFound(ctx, 'CareFollowUp', followUpId);
}
