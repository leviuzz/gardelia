import 'server-only';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getOrderThread, hasPermission, type TenantContext } from '@floral/core';
import { ORDER_MESSAGE_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import {
  markOrderThreadReadAction,
  postOrderMessageAction,
  removeOrderMessagePhotoAction,
} from '@/app/app/[tenantSlug]/orders/[orderId]/message-actions';
import { MarkThreadRead } from '@/components/messages/mark-thread-read';
import { MessageComposer } from '@/components/messages/message-composer';
import { MessageThread, type MessageThreadItem } from '@/components/messages/message-thread';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';

/**
 * «Messaggi» nella pagina di un ordine online (M3, ADR-088): il filo con chi l'ha fatto per tutta la
 * squadra, il modulo fino a 7 giorni dopo la chiusura, «Togli la foto» per chi gestisce gli ordini.
 * Aprirla segna come letti i messaggi di chi compra (dopo il caricamento). Gli ordini del banco non
 * hanno il filo: niente scheda.
 */
export async function OrderMessagesCard({
  ctx,
  orderId,
  pages,
}: {
  readonly ctx: TenantContext;
  readonly orderId: string;
  readonly pages: number;
}) {
  if (!hasPermission(ctx, 'orders:messages')) return null;
  const thread = await getOrderThread(ctx, orderId, pages);
  if (!thread) return null;
  const t = await getTranslations('orders.messages');
  const tThread = await getTranslations('thread.question');
  const answerLabel = (answer: 'YES' | 'NO') => tThread(answer === 'YES' ? 'yes' : 'no');
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const items: MessageThreadItem[] = thread.messages.map((message) => ({
    id: message.id,
    side: message.authorKind === 'SHOP' ? 'own' : 'other',
    author:
      message.authorName ?? (message.authorKind === 'SHOP' ? ctx.tenantName : t('deletedAccount')),
    body: message.body,
    photo: message.hasPhoto
      ? {
          thumbUrl: routes.orders.messagePhoto(orderId, message.id, { thumb: true }),
          fullUrl: routes.orders.messagePhoto(orderId, message.id),
        }
      : null,
    photoGone: message.photoGone,
    at: message.createdAt,
    highlight: message.unread,
    removePhoto:
      thread.canRemovePhotos && message.hasPhoto
        ? removeOrderMessagePhotoAction.bind(null, slug, orderId, message.id)
        : null,
    question:
      message.kind === 'QUESTION'
        ? {
            label: t('question'),
            footer: (
              <p className="text-xs text-muted-foreground">
                {message.reply
                  ? t('customerAnswered', { answer: answerLabel(message.reply) })
                  : t('waitingAnswer')}
              </p>
            ),
          }
        : null,
    answer:
      message.kind === 'ANSWER' && message.answer
        ? { label: answerLabel(message.answer), yes: message.answer === 'YES' }
        : null,
  }));
  return (
    <Card id="mensajes" className="scroll-mt-20 print:hidden" data-testid="order-messages-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          {thread.buyerName ? t('title', { name: thread.buyerName }) : t('titleNoName')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {thread.hasOlder && pages < ORDER_MESSAGE_LIMITS.maxPages ? (
          <Link
            href={routes.orders.thread(orderId, { mensajes: pages + 1 })}
            scroll={false}
            className="block text-center text-sm font-medium text-primary hover:underline"
          >
            {t('older')}
          </Link>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <MessageThread items={items} timeZone={ctx.timezone} dividerLabel={t('unreadDivider')} />
        )}
        {thread.open ? (
          <MessageComposer
            id="order-message"
            action={postOrderMessageAction.bind(null, slug, orderId)}
            maxSide={PHOTO_LIMITS.clientMaxSide}
            maxLength={ORDER_MESSAGE_LIMITS.body}
            questionOption={Boolean(thread.buyerName)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {thread.buyerName ? t('closed') : t('closedNoAccount')}
          </p>
        )}
        {thread.unreadCount > 0 ? (
          <MarkThreadRead action={markOrderThreadReadAction.bind(null, slug, orderId)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
