import 'server-only';
import { Check, PencilLine } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { BuyerOrderDetailDto } from '@floral/core';
import {
  confirmBuyerOrderChangeAction,
  declineBuyerOrderChangeAction,
} from '@/app/cuenta/pedidos/actions';
import { DeclineOrderChangeDialog } from '@/components/account/buyer-order-change-actions';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { OrderChangeList } from '@/components/orders/order-change-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * «{Florería} cambió tu pedido» (M3-2, ADR-088): com'era → com'è, il messaggio della fioreria e la
 * scadenza; «Confirmar cambios» accetta l'ordine, «No, gracias» (con un motivo facoltativo) lo
 * riporta alla fioreria. Solo per una richiesta chiesta su un ordine ancora da accettare; la
 * risposta porta il numero della richiesta, così una versione vecchia non si conferma.
 */
export async function BuyerOrderChangeCard({
  detail,
  locale,
  deadlineLabel,
}: {
  readonly detail: BuyerOrderDetailDto;
  readonly locale: string;
  /** Fino a quando può rispondere (nel fuso della fioreria), o null. */
  readonly deadlineLabel: string | null;
}) {
  const { change, shop, order, orderId } = detail;
  if (!change || change.status !== 'ASKED' || !change.diff) return null;
  const t = await getTranslations('account.orderPage.changes');
  const fields = { round: String(change.round) };
  return (
    <Card id="cambios" className="scroll-mt-20 border-primary/40" data-testid="buyer-order-changes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PencilLine className="size-4 text-primary" aria-hidden="true" />
          {t('title', { shop: shop.name })}
        </CardTitle>
        <CardDescription>{t('body')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {change.message ? (
          <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">
              {t('messageFrom', { shop: shop.name })}
            </figcaption>
            <blockquote className="rounded-2xl bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
              {change.message}
            </blockquote>
          </figure>
        ) : null}
        <OrderChangeList
          diff={change.diff}
          currency={order.currency}
          locale={locale}
          testId="buyer-order-change-list"
        />
        {deadlineLabel ? (
          <p className="text-sm text-muted-foreground">{t('deadline', { date: deadlineLabel })}</p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <ConfirmActionDialog
            action={confirmBuyerOrderChangeAction.bind(null, orderId)}
            trigger={
              <Button className="w-full sm:w-auto">
                <Check />
                {t('confirm')}
              </Button>
            }
            title={t('confirmTitle')}
            description={t('confirmBody', { number: order.numberLabel, shop: shop.name })}
            confirmLabel={t('confirmConfirm')}
            confirmVariant="default"
            fields={fields}
          />
          <DeclineOrderChangeDialog
            action={declineBuyerOrderChangeAction.bind(null, orderId)}
            round={change.round}
            shop={shop.name}
          />
        </div>
      </CardContent>
    </Card>
  );
}
