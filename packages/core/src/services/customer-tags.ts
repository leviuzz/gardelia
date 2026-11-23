/**
 * Etichette dei clienti [CRM-01, ADR-070]: l'elenco delle etichette usate (filtro della lista e
 * suggerimenti) e un'etichetta aggiunta o tolta a più clienti insieme.
 *
 *  - Scrivere spetta a chi modifica i clienti (proprietario e manager), come nella scheda.
 *  - Un cliente di un'altra fioreria fra quelli scelti: 404 per tutto il gruppo, nessuna modifica.
 *  - Un cliente con già 15 etichette viene saltato (e contato): gli altri ricevono l'etichetta.
 *  - Nel registro una voce per gruppo, con quanti e quali clienti: mai il testo dell'etichetta.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CUSTOMER_LIMITS,
  customerBulkTagSchema,
  toFieldErrors,
  type CustomerBulkTagMode,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

/** Quante etichette diverse si propongono al massimo nel filtro. */
export const CUSTOMER_TAG_OPTIONS_MAX = 200;

/** Le etichette usate dai clienti della fioreria, in ordine alfabetico. */
export async function listCustomerTags(ctx: TenantContext): Promise<readonly string[]> {
  requirePermission(ctx, 'customers:read');
  const rows = await withTenantContext(
    getDb(),
    ctx,
    (tx) =>
      tx.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT unnest(tags) AS tag
      FROM "Customer"
      WHERE "tenantId" = ${ctx.tenantId}::uuid
      ORDER BY tag
      LIMIT ${CUSTOMER_TAG_OPTIONS_MAX}`,
  );
  return rows.map((row) => row.tag);
}

export interface CustomerBulkTagResult {
  readonly mode: CustomerBulkTagMode;
  readonly tag: string;
  /** Clienti a cui l'etichetta è stata aggiunta o tolta. */
  readonly changed: number;
  /** Clienti che l'avevano già (aggiungere) o non l'avevano (togliere). */
  readonly unchanged: number;
  /** Clienti saltati perché hanno già il massimo di etichette. */
  readonly full: number;
}

type BulkTagOutcome =
  { readonly missing: string } | { readonly missing: null; readonly result: CustomerBulkTagResult };

/** "Agregar etiqueta" / "Quitar etiqueta" sui clienti scelti nella lista. */
export async function updateCustomerTags(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<CustomerBulkTagResult> {
  requirePermission(ctx, 'customers:write');
  const parsed = customerBulkTagSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { tag, mode } = parsed.data;
  const customerIds = [...new Set(parsed.data.customerIds)];

  const outcome = await withTenantContext(getDb(), ctx, async (tx): Promise<BulkTagOutcome> => {
    const customers = await tx.customer.findMany({
      where: { tenantId: ctx.tenantId, id: { in: customerIds } },
      select: { id: true, tags: true },
      orderBy: { id: 'asc' },
    });
    const found = new Set(customers.map((customer) => customer.id));
    const missing = customerIds.find((id) => !found.has(id));
    if (missing) return { missing };

    const changedIds: string[] = [];
    let unchanged = 0;
    let full = 0;
    for (const customer of customers) {
      const hasTag = customer.tags.includes(tag);
      if (mode === 'add' ? hasTag : !hasTag) {
        unchanged += 1;
        continue;
      }
      if (mode === 'add' && customer.tags.length >= CUSTOMER_LIMITS.tags) {
        full += 1;
        continue;
      }
      const tags =
        mode === 'add' ? [...customer.tags, tag] : customer.tags.filter((value) => value !== tag);
      await tx.customer.updateMany({
        where: { id: customer.id, tenantId: ctx.tenantId },
        data: { tags },
      });
      changedIds.push(customer.id);
    }
    if (changedIds.length > 0) {
      await recordAudit(tx, ctx, {
        action:
          mode === 'add' ? AUDIT_ACTIONS.customerTagsAdded : AUDIT_ACTIONS.customerTagsRemoved,
        entityType: 'Customer',
        metadata: { count: changedIds.length, customerIds: changedIds },
      });
    }
    return {
      missing: null,
      result: { mode, tag, changed: changedIds.length, unchanged, full },
    };
  });
  if (outcome.missing !== null) return notFound(ctx, 'Customer', outcome.missing);
  return outcome.result;
}
