import 'server-only';
import { CircleCheck, Receipt } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { BuyerOrderDetailDto } from '@floral/core';
import {
  ORDER_MONEY_LIMITS,
  minorToDecimalString,
  type CurrencyCode,
  type MoneyReviewStatus,
} from '@floral/domain';
import { submitPaymentProofAction } from '@/app/cuenta/pedidos/actions';
import { BuyerPaymentProofForm } from '@/components/account/buyer-payment-proof-form';
import { PrivateImage } from '@/components/common/private-image';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { accountRoutes } from '@/lib/routes';

const STATUS_BADGE: Record<MoneyReviewStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'danger',
};

/**
 * «Pagos» nella pagina di un ordine online del conto (M3-3, ADR-088): «Ya pagué: sube tu
 * comprobante» dopo l'accettazione e con qualcosa da pagare, le prove con lo stato («En revisión»,
 * «Confirmado», «No lo encontramos» con il motivo della fioreria) e quanto la fioreria ha
 * rimborsato. Niente se non c'è niente da mostrare né da fare.
 */
export async function BuyerOrderPaymentsCard({
  detail,
  locale,
}: {
  readonly detail: BuyerOrderDetailDto;
  readonly locale: string;
}) {
  const { order, shop, orderId, money: data } = detail;
  if (!order.online) return null;
  const limitReached = data.pendingProofs >= ORDER_MONEY_LIMITS.proofsPending;
  if (data.proofs.length === 0 && !data.canSubmitProof && data.refundedMinor === 0) return null;
  const t = await getTranslations('account.orderPage.payments');
  const format = await getFormatter();
  const currency = order.currency as CurrencyCode;
  const fmt = (minor: number) => money(minor, currency, locale);
  const when = (value: Date) =>
    format.dateTime(value, { dateStyle: 'medium', timeStyle: 'short', timeZone: shop.timezone });

  return (
    <Card id="pagos" className="scroll-mt-20" data-testid="buyer-order-payments">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-primary" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        {data.canSubmitProof ? (
          <CardDescription>{t('body', { shop: shop.name })}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {data.refundedMinor > 0 ? (
          <Alert variant="success" data-testid="buyer-order-refunded">
            <CircleCheck aria-hidden="true" />
            <AlertDescription>
              {t('refunded', { shop: shop.name, amount: fmt(data.refundedMinor) })}
            </AlertDescription>
          </Alert>
        ) : null}

        {data.canSubmitProof ? (
          <section className="space-y-3 rounded-xl border p-4">
            <h3 className="font-medium">{t('proofTitle')}</h3>
            <BuyerPaymentProofForm
              action={submitPaymentProofAction.bind(null, orderId)}
              currency={currency}
              defaultAmount={minorToDecimalString(order.balanceMinor, currency)}
            />
          </section>
        ) : limitReached ? (
          <p className="text-sm text-muted-foreground" data-testid="buyer-proofs-limit">
            {t('limit', { shop: shop.name })}
          </p>
        ) : null}

        {data.proofs.length > 0 ? (
          <ul className="divide-y text-sm" data-testid="buyer-proofs">
            {data.proofs.map((proof) => (
              <li
                key={proof.id}
                className="flex flex-wrap items-start gap-3 py-3"
                data-testid="buyer-proof"
              >
                {proof.hasPhoto ? (
                  <a
                    href={accountRoutes.orders.proofPhoto(orderId, proof.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                    aria-label={t('openPhoto', { amount: fmt(proof.amountMinor) })}
                  >
                    <PrivateImage
                      src={accountRoutes.orders.proofPhoto(orderId, proof.id, { thumb: true })}
                      alt=""
                      className="size-14 rounded-lg border object-cover"
                    />
                  </a>
                ) : null}
                <div className="min-w-0 flex-1 basis-40 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{fmt(proof.amountMinor)}</span>
                    <Badge variant={STATUS_BADGE[proof.status]}>
                      {t(`status.${proof.status}`)}
                    </Badge>
                  </p>
                  <p className="text-muted-foreground">
                    {t('sentOn', { date: when(proof.createdAt) })}
                  </p>
                  {proof.note ? (
                    <p className="break-words whitespace-pre-line">{proof.note}</p>
                  ) : null}
                  {proof.rejectReason ? (
                    <p className="break-words">
                      {t('shopSays', { shop: shop.name, reason: proof.rejectReason })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
