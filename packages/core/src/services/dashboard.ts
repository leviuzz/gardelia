/**
 * Dashboard del merchant: SOLO dati reali del tenant (nessun KPI simulato).
 * Le metriche che dipendono da moduli non ancora rilasciati (ordini, consegne)
 * non vengono mostrate finché quei moduli non esistono.
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import { CATALOG_ITEM_TYPES, todayInTimeZone, type CatalogItemType } from '@floral/domain';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';

export interface ActivityEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorName: string | null;
  readonly metadata: Prisma.JsonValue | null;
  readonly createdAt: Date;
}

export interface OnboardingStep {
  readonly key: 'first_product' | 'first_bouquet_recipe' | 'complete_costs' | 'invite_team';
  readonly done: boolean;
}

export interface DashboardData {
  readonly catalog: {
    readonly activeItems: number;
    readonly byType: Readonly<Record<CatalogItemType, number>>;
    readonly outOfStock: number;
    readonly limited: number;
    readonly onRequest: number;
    readonly bouquetsWithoutRecipe: number;
    /** null se l'utente non può vedere i costi. */
    readonly itemsMissingCost: number | null;
  };
  /** Preventivi aperti: bozze e inviati non ancora scaduti. */
  readonly quotes: { readonly drafts: number; readonly sent: number };
  /** null se l'utente non può vedere il team. */
  readonly team: { readonly activeMembers: number; readonly pendingInvitations: number } | null;
  readonly onboarding: readonly OnboardingStep[];
  /** null se l'utente non può vedere il registro attività. */
  readonly recentActivity: readonly ActivityEntry[] | null;
}

/** Tipologie per cui il costo è rilevante ai fini del margine (esclusi bouquet e servizi). */
const COSTED_TYPES: readonly CatalogItemType[] = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PLANT',
  'CONTAINER',
  'PACKAGING',
  'ACCESSORY',
];

export async function getDashboard(ctx: TenantContext): Promise<DashboardData> {
  requirePermission(ctx, 'tenant:read');
  const canSeeCosts = hasPermission(ctx, 'catalog:costs:read');
  const canSeeTeam = hasPermission(ctx, 'members:read');
  const canSeeAudit = hasPermission(ctx, 'audit:read');
  const tenantId = ctx.tenantId;

  // Una transazione è una sola connessione: le query vanno comunque una alla volta, quindi si
  // scrivono in fila (un Promise.all farebbe pensare a un parallelismo che non c'è).
  return withTenantContext(getDb(), ctx, async (tx) => {
    const active = { tenantId, status: 'ACTIVE' } as const;
    const grouped = await tx.catalogItem.groupBy({
      by: ['type'],
      where: active,
      _count: { _all: true },
    });
    const outOfStock = await tx.catalogItem.count({
      where: { ...active, availability: 'OUT_OF_STOCK' },
    });
    const limited = await tx.catalogItem.count({ where: { ...active, availability: 'LIMITED' } });
    const onRequest = await tx.catalogItem.count({
      where: { ...active, availability: 'ON_REQUEST' },
    });
    const bouquetsWithoutRecipe = await tx.catalogItem.count({
      where: {
        ...active,
        type: 'BOUQUET',
        OR: [{ recipe: null }, { recipe: { lines: { none: {} } } }],
      },
    });
    const recipesWithLines = await tx.bouquetRecipe.count({
      where: { tenantId, lines: { some: {} } },
    });

    const byType = Object.fromEntries(CATALOG_ITEM_TYPES.map((type) => [type, 0])) as Record<
      CatalogItemType,
      number
    >;
    for (const row of grouped) byType[row.type] = row._count._all;
    const activeItems = Object.values(byType).reduce((sum, value) => sum + value, 0);

    const itemsMissingCost = canSeeCosts
      ? await tx.catalogItem.count({
          where: { ...active, type: { in: [...COSTED_TYPES] }, costMinor: null },
        })
      : null;

    const today = todayInTimeZone(ctx.timezone);
    const todayDate = new Date(Date.UTC(today.year, today.month - 1, today.day));
    const draftQuotes = await tx.quote.count({ where: { tenantId, status: 'DRAFT' } });
    const sentQuotes = await tx.quote.count({
      where: {
        tenantId,
        status: 'SENT',
        OR: [{ validUntil: null }, { validUntil: { gte: todayDate } }],
      },
    });

    const team = canSeeTeam
      ? {
          activeMembers: await tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
          pendingInvitations: await tx.invitation.count({
            where: { tenantId, status: 'PENDING', expiresAt: { gt: new Date() } },
          }),
        }
      : null;

    let recentActivity: ActivityEntry[] | null = null;
    if (canSeeAudit) {
      const entries = await tx.auditLog.findMany({
        where: { tenantId, NOT: { action: { startsWith: 'security.' } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      });
      const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter((id) => id !== null))];
      const actors = actorIds.length
        ? await tx.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          })
        : [];
      const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
      recentActivity = entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorName: entry.actorUserId ? (actorNames.get(entry.actorUserId) ?? null) : null,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      }));
    }

    const memberCount =
      team?.activeMembers ?? (await tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }));
    const onboarding: OnboardingStep[] = [
      { key: 'first_product', done: activeItems - byType.BOUQUET > 0 },
      { key: 'first_bouquet_recipe', done: recipesWithLines > 0 },
      ...(canSeeCosts
        ? [{ key: 'complete_costs' as const, done: activeItems > 0 && itemsMissingCost === 0 }]
        : []),
      ...(canSeeTeam ? [{ key: 'invite_team' as const, done: memberCount > 1 }] : []),
    ];

    return {
      catalog: {
        activeItems,
        byType,
        outOfStock,
        limited,
        onRequest,
        bouquetsWithoutRecipe,
        itemsMissingCost,
      },
      quotes: { drafts: draftQuotes, sent: sentQuotes },
      team,
      onboarding,
      recentActivity,
    };
  });
}
