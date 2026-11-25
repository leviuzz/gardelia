/**
 * Floral Care, blocco 6b (ADR-085) — l'Asistente de plantas, lato fioreria: i crediti.
 *
 *  - L'assistente è per i clienti della fioreria, in Mi Floral Care (`my-plant-assistant.ts`); il
 *    fiorista non lo consulta (founder, 25/11: sa quello che fa).
 *  - La fioreria compra crediti da Gardelia come quelli delle immagini (WhatsApp, poi l'accredito
 *    della piattaforma: `AiCreditGrant` con `PLANT_ASSISTANT`) e li dà ai suoi contratti quando
 *    vuole («Dar créditos»: proprietario e gerente, perché costano soldi alla fioreria). Come li
 *    rivende ai suoi clienti lo decide lei.
 *  - 1 credito = 1 risposta riuscita del cliente. Saldi calcolati, mai contatori: fioreria =
 *    comprati − dati ai contratti (resi compresi); contratto = dati − risposte − riserve in corso.
 *    A fine contratto i crediti non usati tornano alla fioreria (`returnAssistantCreditsTx`).
 *  - La fioreria vede quante risposte usa un contratto, non le domande del cliente: le vede solo se
 *    il cliente le manda con «Enviar a la florería» (un messaggio del filo).
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  assistantContractAvailable,
  assistantCreditGiveSchema,
  assistantShopAvailable,
  formatSubscriptionNumber,
  isUuid,
  toFieldErrors,
} from '@floral/domain';
import { getPlantAssistants } from '../ai/plant-assistant';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { lockSubscription } from './care-internals';
import { contractAssistantCreditsTx, shopAssistantCreditsTx } from './assistant-credits-internals';

export type { AssistantSpeciesDto } from './plant-assistant-internals';

/** L'assistente è configurato: senza, l'interfaccia non lo mostra (niente funzioni finte). */
export function isPlantAssistantAvailable(): boolean {
  return getPlantAssistants() !== null;
}

/** Ajustes → Floral Care: i crediti della fioreria. */
export interface AssistantCreditsPanelDto {
  /** L'assistente è configurato (altrimenti la card dice che non è ancora attivo). */
  readonly available: boolean;
  /** Assistente finto di sviluppo e test: l'interfaccia lo dice. */
  readonly simulated: boolean;
  /** Comprati da Gardelia. */
  readonly purchased: number;
  /** Dati ai contratti, meno quelli tornati a fine contratto. */
  readonly allocated: number;
  /** Ancora da dare. */
  readonly remaining: number;
  /** Proprietario e gerente danno i crediti. */
  readonly canGive: boolean;
}

export async function getAssistantCreditsPanel(
  ctx: TenantContext,
): Promise<AssistantCreditsPanelDto> {
  requirePermission(ctx, 'subscriptions:read');
  const assistants = getPlantAssistants();
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const shop = await shopAssistantCreditsTx(tx, ctx.tenantId);
    return {
      available: assistants !== null,
      simulated: assistants?.main.simulated ?? false,
      purchased: shop.purchased,
      allocated: shop.allocated,
      remaining: assistantShopAvailable(shop.purchased, shop.allocated),
      canGive: hasPermission(ctx, 'care:assistant'),
    };
  });
}

/** La card «Asistente de plantas» della pagina del contratto. */
export interface ContractAssistantCreditsDto {
  readonly available: boolean;
  readonly simulated: boolean;
  /** Dati dalla fioreria. */
  readonly given: number;
  /** Tornati alla fioreria a fine contratto. */
  readonly returned: number;
  /** Risposte riuscite del cliente. */
  readonly used: number;
  /** Ancora usabili dal cliente. */
  readonly remaining: number;
  readonly lastUsedAt: Date | null;
  /** Il contratto è attivo o in pausa: si possono dare crediti. */
  readonly open: boolean;
  /** I crediti della fioreria ancora da dare. */
  readonly shopRemaining: number;
  readonly canGive: boolean;
  /** Qualcuno del cliente entra in Mi Floral Care per questo contratto (senza, i crediti non servono). */
  readonly hasPortalAccess: boolean;
}

export async function getContractAssistantCredits(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<ContractAssistantCreditsDto> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const assistants = getPlantAssistants();
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { status: true, customerId: true },
    });
    if (!contract) return null;
    const [credits, shop, accesses] = await Promise.all([
      contractAssistantCreditsTx(tx, ctx.tenantId, subscriptionId),
      shopAssistantCreditsTx(tx, ctx.tenantId),
      tx.carePortalAccess.count({
        where: {
          tenantId: ctx.tenantId,
          customerId: contract.customerId,
          revokedAt: null,
          OR: [{ subscriptionId }, { subscriptionId: null }],
        },
      }),
    ]);
    return { contract, credits, shop, accesses };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  const { contract, credits, shop } = found;
  return {
    available: assistants !== null,
    simulated: assistants?.main.simulated ?? false,
    given: credits.given,
    returned: credits.returned,
    used: credits.used,
    remaining: assistantContractAvailable(
      credits.given - credits.returned,
      credits.used,
      credits.held,
    ),
    lastUsedAt: credits.lastUsedAt,
    open: contract.status === 'ACTIVE' || contract.status === 'PAUSED',
    shopRemaining: assistantShopAvailable(shop.purchased, shop.allocated),
    canGive: hasPermission(ctx, 'care:assistant'),
    hasPortalAccess: found.accesses > 0,
  };
}

/**
 * «Dar créditos»: crediti della fioreria a un contratto attivo o in pausa, fino al saldo della
 * fioreria. Il lock per fioreria mette in fila due «Dar créditos» insieme (mai sotto zero).
 */
export async function giveAssistantCredits(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ readonly given: number; readonly shopRemaining: number }> {
  requirePermission(ctx, 'care:assistant');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = assistantCreditGiveSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { credits } = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:assistant-credits'), hashtext(${ctx.tenantId}))`;
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { number: true, status: true },
    });
    if (!contract) return null;
    if (contract.status !== 'ACTIVE' && contract.status !== 'PAUSED') {
      throw new ConflictError('assistant_contract_closed');
    }
    const shop = await shopAssistantCreditsTx(tx, ctx.tenantId);
    const available = assistantShopAvailable(shop.purchased, shop.allocated);
    if (credits > available) throw new ConflictError('assistant_shop_credits');
    await tx.assistantCreditAllocation.create({
      data: {
        tenantId: ctx.tenantId,
        subscriptionId,
        kind: 'GIVE',
        credits,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careAssistantCreditsGiven,
      entityType: 'CustomerSubscription',
      entityId: subscriptionId,
      metadata: { number: formatSubscriptionNumber(contract.number), count: credits },
    });
    return { given: credits, shopRemaining: available - credits };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}
