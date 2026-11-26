import 'server-only';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { BuyerOrderDetailDto } from '@floral/core';
import { ORDER_MESSAGE_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import {
  markBuyerOrderReadAction,
  postBuyerOrderMessageAction,
} from '@/app/cuenta/pedidos/actions';
import { MarkThreadRead } from '@/components/messages/mark-thread-read';
import { MessageComposer } from '@/components/messages/message-composer';
import { MessageThread, type MessageThreadItem } from '@/components/messages/message-thread';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountRoutes } from '@/lib/routes';

/**
 * «Mensajes con …» nella pagina di un ordine online del conto (M3, ADR-088): il filo con la
 * fioreria (chi della fioreria ha scritto) e il modulo fino a 7 giorni dopo la consegna, il ritiro
 * o l'annullamento; poi si legge e basta. Aprirla toglie il «nuevo» ai messaggi della fioreria
 * (dopo il caricamento). Lingua di chi guarda; i testi scritti restano come sono.
 */
export async function BuyerOrderMessagesCard({
  detail,
  pages,
  timeZone,
}: {
  readonly detail: BuyerOrderDetailDto;
  readonly pages: number;
  readonly timeZone: string;
}) {
  const t = await getTranslations();
  const { orderId, thread, shop } = detail;
  const items: MessageThreadItem[] = thread.messages.map((message) => ({
    id: message.id,
    side: message.authorKind === 'BUYER' ? 'own' : 'other',
    author:
      message.authorKind === 'BUYER'
        ? t('account.orderPage.messages.you')
        : (message.authorName ?? shop.name),
    body: message.body,
    photo: message.hasPhoto
      ? {
          thumbUrl: accountRoutes.orders.messagePhoto(orderId, message.id, { thumb: true }),
          fullUrl: accountRoutes.orders.messagePhoto(orderId, message.id),
        }
      : null,
    photoGone: message.photoGone,
    at: message.createdAt,
    highlight: message.unread,
    removePhoto: null,
  }));
  return (
    <Card id="mensajes" className="scroll-mt-20" data-testid="buyer-order-messages">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('account.orderPage.messages.title', { shop: shop.name })}
        </CardTitle>
        {thread.open ? (
          <CardDescription>{t('account.orderPage.messages.subtitle')}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {thread.hasOlder && pages < ORDER_MESSAGE_LIMITS.maxPages ? (
          <Link
            href={accountRoutes.orders.thread(orderId, { mensajes: pages + 1 })}
            scroll={false}
            className="block text-center text-sm font-medium text-primary hover:underline"
          >
            {t('account.orderPage.messages.older')}
          </Link>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('account.orderPage.messages.empty')}</p>
        ) : (
          <MessageThread
            items={items}
            timeZone={timeZone}
            dividerLabel={t('account.orderPage.messages.newDivider')}
          />
        )}
        {thread.open ? (
          <MessageComposer
            id="buyer-order-message"
            action={postBuyerOrderMessageAction.bind(null, orderId)}
            maxSide={PHOTO_LIMITS.clientMaxSide}
            maxLength={ORDER_MESSAGE_LIMITS.body}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('account.orderPage.messages.closed')}</p>
        )}
        {thread.unreadCount > 0 ? (
          <MarkThreadRead action={markBuyerOrderReadAction.bind(null, orderId)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
