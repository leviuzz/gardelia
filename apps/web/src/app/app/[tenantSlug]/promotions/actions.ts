'use server';

/**
 * Server action della promo delle date speciali (ADR-047) e del registro degli sconti
 * (ADR-048): il servizio di @floral/core valida l'input e ricontrolla permessi e fioreria.
 * Contesto, errori e messaggi: `runTenantAction`. Gli ID legati con .bind() arrivano dal client:
 * non sono affidabili (il servizio li cerca solo nella fioreria del contesto).
 */
import { redeemPromoDiscount, undoPromoRedemption, updateOccasionPromo } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function updateOccasionPromoAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOccasionPromo(ctx, formDataToObject(formData));
    // Il calendario mostra se e quando parte la promo di ogni data.
    return {
      revalidate: [section(routes.promotions.home), routes.calendar()],
      success: 'promotions.saved',
    };
  });
}

/** Sconto usato (il cliente l'ha citato su WhatsApp o in negozio), con una nota facoltativa. */
export async function redeemPromoDiscountAction(
  slug: string,
  discountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await redeemPromoDiscount(ctx, discountId, formDataToObject(formData));
    // Registro, scheda del cliente e calendario mostrano lo sconto usato.
    return {
      revalidate: [
        section(routes.promotions.home),
        section(routes.customers.list()),
        routes.calendar(),
      ],
      success: 'promotions.discounts.redeemed',
    };
  });
}

export async function undoPromoRedemptionAction(
  slug: string,
  discountId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await undoPromoRedemption(ctx, discountId);
    return {
      revalidate: [
        section(routes.promotions.home),
        section(routes.customers.list()),
        routes.calendar(),
      ],
      success: 'promotions.discounts.undone',
    };
  });
}
