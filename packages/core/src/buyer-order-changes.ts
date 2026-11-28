/**
 * Marketplace M3-2 «Cambi da confermare» (ADR-088) — il lato di chi compra, sempre dall'ingresso
 * unico `withBuyerOrder` (la fioreria dell'ordine solo per chi l'ha fatto, la guardia del database
 * sull'ordine, il lock):
 *
 *  - «Confirmar cambios»: l'ordine è accettato come con «Accetta l'ordine», ma chi compra non scrive
 *    nell'inventario della fioreria: la merce si mette da parte al primo passo del fiorista
 *    (`changeOrderStatus` chiama `syncOrderReservationTx`);
 *  - «No, gracias», con un motivo facoltativo: l'ordine torna alla fioreria;
 *  - la risposta «Sí» / «No» a una domanda della fioreria nel filo dei messaggi.
 *
 * Ogni risposta vale solo per la richiesta che la persona ha visto (`round`). Il registro le scrive
 * con chi compra come autore, come «Cancelar pedido».
 */
import type { TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  answerOrderChangeSchema,
  diffOrderChanges,
  formatOrderNumber,
  hasOrderChanges,
  newId,
  orderAnswerProblem,
  orderChangeAnswerProblem,
  orderQuestionAnswerSchema,
  parseOrderChangeSnapshot,
  todayInTimeZone,
  toFieldErrors,
  type OrderChangeStatus,
  type OrderStatus,
} from '@floral/domain';
import { withBuyerOrder } from './buyer-orders';
import type { RequestMeta } from './context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { logger } from './logger';
import type { EmailMessage } from './mailer';
import { claimMessageNoticeTx } from './order-message-internals';
import {
  buyerOrderMail,
  changeAnsweredMailsForShop,
  sendOrderMails,
  shopMessageNoticeMails,
  type OrderMailDeps,
} from './order-mail';
import type { BuyerContext } from './services/buyer-account';
import { orderSnapshotSelect, orderSnapshotTx } from './services/order-changes';
import { dateToParts } from './services/quote-internals';

/**
 * La richiesta che la persona sta guardando, se le si può ancora rispondere (`orderChangeAnswerProblem`
 * del dominio): giorno non passato per «Confirmar», ordine da accettare, richiesta ancora chiesta e
 * con lo stesso numero.
 */
async function answerableRequestTx(
  tx: TransactionClient,
  tenantId: string,
  order: { readonly id: string; readonly status: OrderStatus; readonly scheduledDate: Date | null },
  round: number,
  confirming: boolean,
) {
  const [request, tenant] = await Promise.all([
    tx.orderChangeRequest.findUnique({
      where: { tenantId_orderId: { tenantId, orderId: order.id } },
      select: { id: true, status: true, round: true, after: true },
    }),
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } }),
  ]);
  const problem = orderChangeAnswerProblem({
    orderStatus: order.status,
    scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
    today: todayInTimeZone(tenant.timezone),
    request: request ? { status: request.status as OrderChangeStatus, round: request.round } : null,
    round,
    confirming,
  });
  if (problem || !request) throw new ConflictError(problem ?? 'order_change_outdated');
  return request;
}

/**
 * «Confirmar cambios»: chi compra accetta l'ordine com'è adesso (quello che la fioreria ha chiesto).
 * Riceve l'email di sempre con come pagare; proprietari e gerenti ne ricevono una anche loro.
 */
export async function confirmBuyerOrderChange(
  buyer: BuyerContext,
  orderId: string,
  rawInput: unknown,
  deps: OrderMailDeps | null,
  options: { readonly request?: RequestMeta } = {},
): Promise<void> {
  const parsed = answerOrderChangeSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { round } = parsed.data;
  const { tenantId, mails } = await withBuyerOrder(
    buyer,
    orderId,
    async (tx, { shop, order }) => {
      const tenantId = shop.tenantId;
      const request = await answerableRequestTx(tx, tenantId, order, round, true);
      // L'ordine dev'essere ancora quello che la fioreria ha chiesto di confermare: ogni cambio della
      // fioreria ritira la richiesta, e qui lo si ricontrolla comunque sui dati (mai una versione
      // che la persona non ha visto).
      const asked = request.after === null ? null : parseOrderChangeSnapshot(request.after);
      const current = await orderSnapshotTx(
        tx,
        tenantId,
        await tx.order.findFirstOrThrow({
          where: { tenantId, id: order.id },
          select: orderSnapshotSelect,
        }),
      );
      if (!asked || hasOrderChanges(diffOrderChanges(asked, current))) {
        throw new ConflictError('order_change_outdated');
      }
      const now = new Date();
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED', statusChangedAt: now },
      });
      await tx.orderStatusEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'CONFIRMED',
          createdById: buyer.userId,
        },
      });
      await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: { status: 'CONFIRMED', answeredAt: now },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: buyer.userId,
          action: AUDIT_ACTIONS.orderChangeConfirmed,
          entityType: 'Order',
          entityId: order.id,
          metadata: { number: formatOrderNumber(order.number), round },
          requestId: options.request?.requestId ?? null,
          ipAddress: options.request?.ipAddress ?? null,
        },
      });
      if (!deps) return { tenantId, mails: [] as EmailMessage[] };
      const mails = [
        await buyerOrderMail(tx, tenantId, order.id, 'accepted', deps),
        ...(await changeAnsweredMailsForShop(tx, tenantId, order.id, 'CONFIRMED', deps)),
      ].filter((mail) => mail !== null);
      return { tenantId, mails };
    },
    { lock: true },
  );
  logger.info({ tenantId, orderId }, 'cambi confermati da chi compra');
  if (deps) await sendOrderMails(deps.mailer, mails);
}

/** «No, gracias»: l'ordine torna alla fioreria, che lo cambia di nuovo o lo rifiuta. */
export async function declineBuyerOrderChange(
  buyer: BuyerContext,
  orderId: string,
  rawInput: unknown,
  deps: OrderMailDeps | null,
  options: { readonly request?: RequestMeta } = {},
): Promise<void> {
  const parsed = answerOrderChangeSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { round, reason } = parsed.data;
  const { tenantId, mails } = await withBuyerOrder(
    buyer,
    orderId,
    async (tx, { shop, order }) => {
      const tenantId = shop.tenantId;
      const request = await answerableRequestTx(tx, tenantId, order, round, false);
      await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: { status: 'DECLINED', answeredAt: new Date(), declineReason: reason },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: buyer.userId,
          action: AUDIT_ACTIONS.orderChangeDeclined,
          entityType: 'Order',
          entityId: order.id,
          // Se c'è un motivo, mai il testo.
          metadata: {
            number: formatOrderNumber(order.number),
            round,
            ...(reason ? { withReason: true } : {}),
          },
          requestId: options.request?.requestId ?? null,
          ipAddress: options.request?.ipAddress ?? null,
        },
      });
      const mails = deps
        ? await changeAnsweredMailsForShop(tx, tenantId, order.id, 'DECLINED', deps)
        : [];
      return { tenantId, mails };
    },
    { lock: true },
  );
  logger.info({ tenantId, orderId }, 'cambi rifiutati da chi compra');
  if (deps) await sendOrderMails(deps.mailer, mails);
}

export interface BuyerQuestionAnswerResult {
  readonly id: string;
  /** È partito l'avviso per email a proprietari e gerenti. */
  readonly notified: boolean;
}

/**
 * La risposta «Sí» / «No» a una domanda della fioreria: entra nel filo come un messaggio di chi
 * compra e avvisa come un messaggio (al primo da leggere, poi al massimo ogni 6 ore). Una risposta
 * per domanda (anche il database lo impone), solo col filo aperto.
 */
export async function answerBuyerOrderQuestion(
  buyer: BuyerContext,
  orderId: string,
  rawInput: unknown,
  deps: OrderMailDeps | null,
): Promise<BuyerQuestionAnswerResult> {
  const parsed = orderQuestionAnswerSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const id = newId();
  const saved = await withBuyerOrder(
    buyer,
    orderId,
    async (tx, { shop, order }) => {
      const tenantId = shop.tenantId;
      const question = await tx.orderMessage.findFirst({
        where: { tenantId, orderId: order.id, id: input.messageId, kind: 'QUESTION' },
        select: { id: true, reply: { select: { id: true } } },
      });
      if (!question) throw new NotFoundError('OrderMessage');
      const problem = orderAnswerProblem({ order, alreadyAnswered: question.reply !== null });
      if (problem) throw new ConflictError(problem);
      const created = await tx.orderMessage.createManyAndReturn({
        data: [
          {
            id,
            tenantId,
            orderId: order.id,
            authorKind: 'BUYER',
            authorUserId: buyer.userId,
            kind: 'ANSWER',
            answer: input.answer,
            answersMessageId: question.id,
            submitKey: id,
          },
        ],
        // Due risposte insieme: la seconda trova la prima (una per domanda, indice unico).
        skipDuplicates: true,
        select: { id: true },
      });
      if (created.length === 0) throw new ConflictError('order_question_answered');
      const notify = await claimMessageNoticeTx(tx, {
        tenantId,
        orderId: order.id,
        buyerUserId: buyer.userId,
        to: 'SHOP',
        messageId: id,
      });
      const mails =
        notify && deps ? await shopMessageNoticeMails(tx, tenantId, order.id, deps) : [];
      return { tenantId, mails };
    },
    { lock: true },
  );
  logger.info({ tenantId: saved.tenantId, orderId }, 'risposta di chi compra a una domanda');
  if (deps && saved.mails.length > 0) await sendOrderMails(deps.mailer, saved.mails);
  return { id, notified: saved.mails.length > 0 };
}
