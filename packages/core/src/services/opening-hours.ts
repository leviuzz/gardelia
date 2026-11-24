/**
 * Orari di apertura della tienda principale (V1 §2.2): li cambia chi gestisce la fioreria, li
 * vedono la tienda en línea e le cotizaciones stampate. Regole in `@floral/domain` (opening-hours).
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  WEEKDAYS,
  formatOpeningRanges,
  openingHoursSchema,
  toFieldErrors,
  type OpeningDay,
} from '@floral/domain';
import { recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';

export interface OpeningHoursDto {
  /** Un elemento per giorno, da domenica (0) a sabato (6); fasce in ordine, vuoto = chiuso. */
  readonly days: readonly OpeningDay[];
  /** La fioreria ha indicato almeno una fascia. */
  readonly configured: boolean;
  /** Chi guarda può cambiarli. */
  readonly canWrite: boolean;
}

/**
 * Le fasce della tienda principale, dentro una transazione già aperta nel contesto della fioreria
 * (la usano anche la tienda en línea e i link pubblici, senza un membro).
 */
export async function loadOpeningHours(
  tx: TransactionClient,
  tenantId: string,
): Promise<OpeningDay[]> {
  const rows = await tx.openingHoursRange.findMany({
    where: { tenantId, location: { isPrimary: true } },
    orderBy: [{ weekday: 'asc' }, { startMinutes: 'asc' }],
    select: { weekday: true, startMinutes: true, endMinutes: true },
  });
  return WEEKDAYS.map((weekday) => ({
    weekday,
    ranges: rows
      .filter((row) => row.weekday === weekday)
      .map((row) => ({ start: row.startMinutes, end: row.endMinutes })),
  }));
}

export async function getOpeningHours(ctx: TenantContext): Promise<OpeningHoursDto> {
  requirePermission(ctx, 'tenant:read');
  const days = await withTenantContext(getDb(), ctx, (tx) => loadOpeningHours(tx, ctx.tenantId));
  return {
    days,
    configured: days.some((day) => day.ranges.length > 0),
    canWrite: hasPermission(ctx, 'tenant:settings:update'),
  };
}

/** Testo breve per il registro: "1: 09:00–14:00, 16:00–20:00 · 6: 10:00–14:00". */
function summary(days: readonly OpeningDay[]): string {
  return days
    .filter((day) => day.ranges.length > 0)
    .map((day) => `${day.weekday}: ${formatOpeningRanges(day.ranges)}`)
    .join(' · ');
}

/**
 * Sostituisce tutte le fasce della settimana (il form le manda tutte insieme). Senza fasce
 * l'orario torna "non indicato".
 */
export async function updateOpeningHours(ctx: TenantContext, raw: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = openingHoursSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const days = parsed.data;

  await withTenantContext(getDb(), ctx, async (tx) => {
    const location = await tx.location.findFirst({
      where: { tenantId: ctx.tenantId, isPrimary: true },
      select: { id: true },
    });
    // Ogni fioreria ha la sua sede principale dall'onboarding.
    if (!location) throw new NotFoundError('Location');
    // Due salvataggi insieme non mescolano le fasce: si lavora una sede alla volta.
    await tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${location.id}::uuid FOR UPDATE`;

    const before = await loadOpeningHours(tx, ctx.tenantId);
    const from = summary(before);
    const to = summary(days);
    if (from === to) return;

    await tx.openingHoursRange.deleteMany({
      where: { tenantId: ctx.tenantId, locationId: location.id },
    });
    const rows = days.flatMap((day) =>
      day.ranges.map((range) => ({
        tenantId: ctx.tenantId,
        locationId: location.id,
        weekday: day.weekday,
        startMinutes: range.start,
        endMinutes: range.end,
      })),
    );
    if (rows.length > 0) await tx.openingHoursRange.createMany({ data: rows });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.locationUpdated,
      entityType: 'Location',
      entityId: location.id,
      metadata: { changes: { openingHours: { from, to } } },
    });
  });
}
