'use server';

/**
 * Server action della pagina di un ordine online nel conto di chi l'ha fatto (M3, ADR-088). La
 * persona arriva SOLO dalla sessione (`runBuyerAction`); l'ID dell'ordine legato con `.bind()` viene
 * dal browser e il servizio lo cerca solo fra gli ordini della persona (un altro risponde 404).
 */
import {
  answerBuyerOrderQuestion,
  confirmBuyerOrderChange,
  declineBuyerOrderChange,
  markBuyerOrderRead,
  postBuyerOrderMessage,
  submitBuyerPaymentProof,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { getRequestMeta } from '@/lib/request-meta';
import { accountRoutes } from '@/lib/routes';
import { optionalUploadedBytes } from '@/lib/uploads';

/** Le pagine che mostrano un ordine di chi compra: la sua pagina e «I miei ordini». */
function buyerOrderPaths(orderId: string): readonly string[] {
  return [accountRoutes.orders.detail(orderId), accountRoutes.home];
}

/** Un messaggio alla fioreria: testo e/o una foto (il modulo la riduce prima dell'invio). */
export async function postBuyerOrderMessageAction(
  orderId: string,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photo = await optionalUploadedBytes(formData);
      await postBuyerOrderMessage(
        ctx,
        orderId,
        { body: formData.get('body'), submitKey: formData.get('submitKey') },
        photo,
        orderMailDeps(),
      );
      return {
        revalidate: [accountRoutes.orders.detail(orderId), accountRoutes.home],
        success: 'account.orderPage.messages.sent',
      };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}

/** Il filo si è visto: i messaggi della fioreria non sono più nuovi (senza ricaricare la pagina). */
export async function markBuyerOrderReadAction(orderId: string): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await markBuyerOrderRead(ctx, orderId);
    return {};
  });
}

/**
 * M3-2 «Confirmar cambios»: la persona accetta l'ordine come l'ha cambiato la fioreria. `round` è la
 * richiesta che ha visto: se nel frattempo la fioreria l'ha cambiato ancora, il servizio rifiuta.
 */
export async function confirmBuyerOrderChangeAction(
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      await confirmBuyerOrderChange(ctx, orderId, formDataToObject(formData), orderMailDeps(), {
        request: await getRequestMeta(),
      });
      return {
        revalidate: buyerOrderPaths(orderId),
        success: 'account.orderPage.changes.confirmed',
      };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}

/** M3-2 «No, gracias», con un motivo facoltativo: l'ordine torna alla fioreria. */
export async function declineBuyerOrderChangeAction(
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      await declineBuyerOrderChange(ctx, orderId, formDataToObject(formData), orderMailDeps(), {
        request: await getRequestMeta(),
      });
      return {
        revalidate: buyerOrderPaths(orderId),
        success: 'account.orderPage.changes.declined',
      };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}

/** M3-2: «Sí» o «No» a una domanda della fioreria nel filo (una risposta per domanda). */
export async function answerBuyerOrderQuestionAction(
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      await answerBuyerOrderQuestion(ctx, orderId, formDataToObject(formData), orderMailDeps());
      return {
        revalidate: buyerOrderPaths(orderId),
        success: 'account.orderPage.messages.answered',
      };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}

/**
 * M3-3 «Ya pagué»: la prova del pagamento (importo, nota e la foto, ridotta dal modulo prima
 * dell'invio). La chiave dell'invio viene dal modulo: lo stesso invio due volte non scrive due prove.
 */
export async function submitPaymentProofAction(
  orderId: string,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photo = await optionalUploadedBytes(formData);
      await submitBuyerPaymentProof(
        ctx,
        orderId,
        {
          amount: formData.get('amount'),
          note: formData.get('note'),
          submitKey: formData.get('submitKey'),
        },
        photo,
        orderMailDeps(),
        { request: await getRequestMeta() },
      );
      return { revalidate: buyerOrderPaths(orderId), success: 'account.orderPage.payments.sent' };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}
