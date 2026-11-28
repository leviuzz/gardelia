/**
 * Marketplace M3-3 «Soldi e squadra» (ADR-088) — le prove di pagamento di chi ha fatto l'ordine
 * online, dal suo conto: «Ya pagué: sube tu comprobante» (foto, importo, nota) dopo l'accettazione e
 * con qualcosa da pagare, al massimo 3 in attesa. Sempre dall'ingresso unico `withBuyerOrder`: la
 * fioreria dell'ordine solo per chi l'ha fatto, il lock dell'ordine (la fioreria che decide una prova
 * blocca lo stesso ordine) e la guardia del database su `OrderPaymentProof`.
 *
 * La foto segue la catena di quelle dei messaggi: ridotta nel browser, ricodificata senza EXIF qui,
 * salvata prima della transazione (`storeFilesThenCommit`), letta solo da rotte private. Si cancella
 * 30 giorni dopo la chiusura dell'ordine (`purgeOrderPaymentProofPhotos`). Proprietari e gerenti
 * ricevono l'avviso per email dopo il commit; il registro scrive chi compra come autore, con
 * l'importo e mai la nota.
 */
import type { TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  formatOrderNumber,
  isUuid,
  newId,
  orderBalanceMinor,
  paymentProofProblem,
  paymentProofSchema,
  toFieldErrors,
  type CurrencyCode,
  type FieldErrors,
  type PaymentProofInput,
} from '@floral/domain';
import { withBuyerOrder } from './buyer-orders';
import type { RequestMeta } from './context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { logger } from './logger';
import { normalizeUploadedPhoto } from './media/images';
import {
  deleteUnusedFiles,
  storeFilesThenCommit,
  type FileToStore,
  type StoredImage,
} from './media/stored-files';
import type { EmailMessage } from './mailer';
import { paymentProofReceivedMailsForShop, sendOrderMails, type OrderMailDeps } from './order-mail';
import { readStoredImageOrNull } from './public-links';
import type { BuyerContext } from './services/buyer-account';

/** Lo stato dell'ordine che decide se si può caricare una prova (`paymentProofProblem`). */
async function proofStateTx(tx: TransactionClient, tenantId: string, orderId: string) {
  const order = await tx.order.findFirstOrThrow({
    where: { tenantId, id: orderId },
    select: { number: true, status: true, currency: true, paidMinor: true, totalMinor: true },
  });
  const pendingProofs = await tx.orderPaymentProof.count({
    where: { tenantId, orderId, status: 'PENDING' },
  });
  return {
    number: order.number,
    status: order.status,
    currency: order.currency as CurrencyCode,
    balanceMinor: orderBalanceMinor(order.paidMinor, order.totalMinor),
    pendingProofs,
  };
}

type ProofState = Awaited<ReturnType<typeof proofStateTx>>;

/** Importo e nota nella valuta dell'ordine; la foto è obbligatoria (PROPOSTO in ADR-088). */
function parseProof(rawInput: unknown, currency: CurrencyCode, hasPhoto: boolean) {
  const parsed = paymentProofSchema(currency).safeParse(rawInput);
  const errors: FieldErrors = parsed.success ? {} : { ...toFieldErrors(parsed.error) };
  if (!hasPhoto) errors.photo = 'file_required';
  if (!parsed.success || !hasPhoto) throw new ValidationError(errors);
  return parsed.data;
}

function assertProofAllowed(state: ProofState, input: PaymentProofInput): void {
  const problem = paymentProofProblem({
    status: state.status,
    balanceMinor: state.balanceMinor,
    pendingProofs: state.pendingProofs,
    amountMinor: input.amount,
  });
  if (problem === 'payment_exceeds_balance') throw new ValidationError({ amount: problem });
  if (problem) throw new ConflictError(problem);
}

/** La foto della prova, pronta da salvare nella cartella della fioreria (CHECK nel database). */
async function preparePaymentProofPhoto(
  tenantId: string,
  orderId: string,
  bytes: Uint8Array,
): Promise<{
  readonly files: readonly FileToStore[];
  readonly row: {
    readonly photoKey: string;
    readonly photoThumbKey: string;
    readonly photoWidth: number;
    readonly photoHeight: number;
  };
}> {
  const image = await normalizeUploadedPhoto(bytes, 'photo');
  const id = newId();
  const photoKey = `tenants/${tenantId}/order-payment-proofs/${orderId}-${id}.jpg`;
  const photoThumbKey = `tenants/${tenantId}/order-payment-proofs/${orderId}-${id}-thumb.jpg`;
  return {
    files: [
      { key: photoKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: photoThumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    row: {
      photoKey,
      photoThumbKey,
      photoWidth: image.full.width,
      photoHeight: image.full.height,
    },
  };
}

export interface BuyerPaymentProofResult {
  readonly id: string;
  /** Lo stesso invio era già arrivato: nessuna prova in più. */
  readonly duplicate: boolean;
}

/**
 * «Ya pagué»: chi ha fatto l'ordine carica la prova del pagamento. Resta «En revisión» finché la
 * fioreria la conferma (diventa un pagamento) o risponde «No lo encontramos» con un motivo.
 */
export async function submitBuyerPaymentProof(
  buyer: BuyerContext,
  orderId: string,
  rawInput: unknown,
  photo: Uint8Array | null,
  deps: OrderMailDeps | null,
  options: { readonly request?: RequestMeta } = {},
): Promise<BuyerPaymentProofResult> {
  const hasPhoto = photo !== null && photo.byteLength > 0;
  // Prima un controllo veloce con le stesse regole, così una prova rifiutata non elabora né carica
  // la foto.
  const precheck = await withBuyerOrder(buyer, orderId, async (tx, { shop, order }) => {
    const state = await proofStateTx(tx, shop.tenantId, order.id);
    const input = parseProof(rawInput, state.currency, hasPhoto);
    const existing = await tx.orderPaymentProof.findFirst({
      where: { tenantId: shop.tenantId, orderId: order.id, submitKey: input.submitKey },
      select: { id: true },
    });
    if (existing) return { tenantId: shop.tenantId, input, duplicate: existing.id };
    assertProofAllowed(state, input);
    return { tenantId: shop.tenantId, input, duplicate: null };
  });
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true };
  if (!photo) throw new ValidationError({ photo: 'file_required' });

  const { input } = precheck;
  const prepared = await preparePaymentProofPhoto(precheck.tenantId, orderId, photo);
  const id = newId();
  const commit = () =>
    withBuyerOrder(
      buyer,
      orderId,
      async (tx, { shop, order }) => {
        const tenantId = shop.tenantId;
        const existing = await tx.orderPaymentProof.findFirst({
          where: { tenantId, orderId: order.id, submitKey: input.submitKey },
          select: { id: true },
        });
        if (existing) return { id: existing.id, duplicate: true, mails: [] as EmailMessage[] };
        const state = await proofStateTx(tx, tenantId, order.id);
        assertProofAllowed(state, input);
        const created = await tx.orderPaymentProof.createManyAndReturn({
          data: [
            {
              id,
              tenantId,
              orderId: order.id,
              buyerUserId: buyer.userId,
              amountMinor: input.amount,
              note: input.note,
              ...prepared.row,
              submitKey: input.submitKey,
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        if (created.length === 0) return { id, duplicate: true, mails: [] as EmailMessage[] };
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: buyer.userId,
            action: AUDIT_ACTIONS.orderPaymentProofSubmitted,
            entityType: 'Order',
            entityId: order.id,
            // L'importo sì, mai la nota né i dati della foto.
            metadata: { number: formatOrderNumber(state.number), amountMinor: input.amount },
            requestId: options.request?.requestId ?? null,
            ipAddress: options.request?.ipAddress ?? null,
          },
        });
        const mails = deps
          ? await paymentProofReceivedMailsForShop(tx, tenantId, order.id, input.amount, deps)
          : [];
        return { id, duplicate: false, mails };
      },
      { lock: true },
    );
  const saved = await storeFilesThenCommit(prepared.files, commit);
  if (!saved) throw new NotFoundError('Order');
  if (saved.duplicate) await deleteUnusedFiles(prepared.files.map((file) => file.key));
  if (deps && saved.mails.length > 0) await sendOrderMails(deps.mailer, saved.mails);
  logger.info({ tenantId: precheck.tenantId, orderId }, 'prova di pagamento di chi compra');
  return { id: saved.id, duplicate: saved.duplicate };
}

/** La foto di una propria prova di pagamento (`thumb` = miniatura), finché c'è. */
export async function getBuyerPaymentProofPhoto(
  buyer: BuyerContext,
  orderId: string,
  proofId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage | null> {
  if (!isUuid(proofId)) return null;
  const proof = await withBuyerOrder(buyer, orderId, (tx, { shop, order }) =>
    tx.orderPaymentProof.findFirst({
      where: { tenantId: shop.tenantId, orderId: order.id, id: proofId, photoDeletedAt: null },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!proof) return null;
  return readStoredImageOrNull(
    variant === 'thumb' ? proof.photoThumbKey : proof.photoKey,
    'image/jpeg',
    'OrderPaymentProof',
  );
}
