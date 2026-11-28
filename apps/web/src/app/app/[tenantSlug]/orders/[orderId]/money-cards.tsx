import 'server-only';
import { Banknote, Receipt } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { OrderMoneyDto } from '@floral/core';
import { minorToDecimalString, type CurrencyCode, type MoneyReviewStatus } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import {
  confirmCashCollectionAction,
  confirmPaymentProofAction,
  rejectCashCollectionAction,
  rejectPaymentProofAction,
  submitCashCollectionAction,
} from '../actions';
import {
  CashCollectionDialog,
  ConfirmCashDialog,
  ConfirmProofDialog,
  RejectMoneyDialog,
} from './money-forms';

const STATUS_BADGE: Record<MoneyReviewStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'danger',
};

/**
 * Le schede dei soldi di un ordine (M3-3, ADR-088): «Prove di pagamento» (solo proprietario e
 * gerente: le foto contengono dati bancari) e «Contanti» (chi consegna li segna, proprietario e
 * gerente li confermano). Niente se non c'è niente da mostrare né da fare.
 */
export async function OrderMoneyCards({
  slug,
  orderId,
  money: data,
  paidMinor,
  today,
  timeZone,
}: {
  readonly slug: string;
  readonly orderId: string;
  readonly money: OrderMoneyDto;
  readonly paidMinor: number;
  /** "AAAA-MM-GG": un pagamento non può essere nel futuro. */
  readonly today: string;
  /** Il fuso della fioreria, per le ore. */
  readonly timeZone: string;
}) {
  const t = await getTranslations('orders.money');
  const format = await getFormatter();
  const routes = tenantRoutes(slug);
  const currency = data.currency as CurrencyCode;
  const fmt = (minor: number) => money(minor, currency);
  const when = (value: Date) =>
    format.dateTime(value, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const showProofs = data.canReview && data.proofs.length > 0;
  const showCash = data.cash.length > 0 || data.canCollectCash;
  if (!showProofs && !showCash) return null;

  return (
    <>
      {showProofs ? (
        <Card className="print:hidden" data-testid="order-proofs">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-4 text-primary" aria-hidden="true" />
              {t('proofsTitle')}
            </CardTitle>
            <CardDescription>{t('proofsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.proofs.map((proof) => {
                const amount = fmt(proof.amountMinor);
                // «Confermo» propone l'importo della prova, fino a quanto manca.
                const proposed = Math.min(proof.amountMinor, data.balanceMinor);
                return (
                  <li
                    key={proof.id}
                    className="flex flex-wrap items-start gap-3 py-3"
                    data-testid="order-proof"
                  >
                    {proof.photo ? (
                      <a
                        href={routes.orders.proofPhoto(orderId, proof.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0"
                        aria-label={t('openPhoto', { amount })}
                      >
                        <PrivateImage
                          src={routes.orders.proofPhoto(orderId, proof.id, { thumb: true })}
                          alt=""
                          className="size-16 rounded-lg border object-cover"
                        />
                      </a>
                    ) : null}
                    <div className="min-w-0 flex-1 basis-40 space-y-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">{amount}</span>
                        <Badge variant={STATUS_BADGE[proof.status]}>
                          {t(`proofStatus.${proof.status}`)}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground">
                        {t('proofFrom', {
                          name: proof.buyerName ?? t('deletedBuyer'),
                          date: when(proof.createdAt),
                        })}
                      </p>
                      {proof.note ? (
                        <p className="break-words whitespace-pre-line">{proof.note}</p>
                      ) : null}
                      {proof.rejectReason ? (
                        <p className="break-words text-muted-foreground">
                          {t('rejectedBecause', { reason: proof.rejectReason })}
                        </p>
                      ) : null}
                      {proof.photo ? null : (
                        <p className="text-xs text-muted-foreground">{t('photoGone')}</p>
                      )}
                      {proof.status === 'PENDING' && !data.canConfirm ? (
                        <p className="text-xs text-muted-foreground">{t('proofClosedOrder')}</p>
                      ) : null}
                    </div>
                    {proof.status === 'PENDING' ? (
                      <div className="flex flex-wrap gap-2">
                        {data.canConfirm && proposed > 0 ? (
                          <ConfirmProofDialog
                            proofId={proof.id}
                            action={confirmPaymentProofAction.bind(null, slug, orderId, proof.id)}
                            currency={currency}
                            today={today}
                            defaultAmount={minorToDecimalString(proposed, currency)}
                            defaultKind={
                              paidMinor > 0 || proposed >= data.balanceMinor ? 'BALANCE' : 'DEPOSIT'
                            }
                            amountLabel={amount}
                          />
                        ) : null}
                        <RejectMoneyDialog
                          rowId={proof.id}
                          kind="proof"
                          action={rejectPaymentProofAction.bind(null, slug, orderId, proof.id)}
                          amountLabel={amount}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {showCash ? (
        <Card className="print:hidden" data-testid="order-cash">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-4 text-primary" aria-hidden="true" />
              {t('cashTitle')}
            </CardTitle>
            <CardDescription>{t('cashHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.cash.length > 0 ? (
              <ul className="divide-y text-sm">
                {data.cash.map((row) => {
                  const amount = fmt(row.amountMinor);
                  const proposed = Math.min(row.amountMinor, data.balanceMinor);
                  return (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-start gap-3 py-3"
                      data-testid="order-cash-row"
                    >
                      <div className="min-w-0 flex-1 basis-40 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-medium tabular-nums">{amount}</span>
                          <Badge variant={STATUS_BADGE[row.status]}>
                            {t(`cashStatus.${row.status}`)}
                          </Badge>
                        </p>
                        <p className="text-muted-foreground">
                          {t('cashBy', { name: row.collectedByName, date: when(row.createdAt) })}
                        </p>
                        {row.confirmedMinor !== null && row.confirmedMinor !== row.amountMinor ? (
                          <p>{t('cashConfirmedAmount', { amount: fmt(row.confirmedMinor) })}</p>
                        ) : null}
                        {row.note ? (
                          <p className="break-words whitespace-pre-line">{row.note}</p>
                        ) : null}
                        {row.rejectReason ? (
                          <p className="break-words text-muted-foreground">
                            {t('rejectedBecause', { reason: row.rejectReason })}
                          </p>
                        ) : null}
                      </div>
                      {row.status === 'PENDING' && data.canReview ? (
                        <div className="flex flex-wrap gap-2">
                          {data.canConfirm && proposed > 0 ? (
                            <ConfirmCashDialog
                              collectionId={row.id}
                              action={confirmCashCollectionAction.bind(null, slug, orderId, row.id)}
                              currency={currency}
                              defaultAmount={minorToDecimalString(proposed, currency)}
                              amountLabel={amount}
                            />
                          ) : null}
                          <RejectMoneyDialog
                            rowId={row.id}
                            kind="cash"
                            action={rejectCashCollectionAction.bind(null, slug, orderId, row.id)}
                            amountLabel={amount}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {data.canCollectCash ? (
              <CashCollectionDialog
                orderId={orderId}
                action={submitCashCollectionAction.bind(null, slug, orderId)}
                currency={currency}
                defaultAmount={minorToDecimalString(data.balanceMinor, currency)}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
