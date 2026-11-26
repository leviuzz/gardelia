import 'server-only';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCareThread, hasPermission, type TenantContext } from '@floral/core';
import { CARE_MESSAGE_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import {
  markCareThreadReadAction,
  postCareMessageAction,
  removeCareMessagePhotoAction,
} from '@/app/app/[tenantSlug]/subscriptions/[subscriptionId]/message-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { MarkThreadRead } from '@/components/messages/mark-thread-read';
import { MessageComposer } from '@/components/messages/message-composer';
import { MessageThread, type MessageThreadItem } from '@/components/messages/message-thread';

/**
 * «Mensajes» nella pagina del contratto (ADR-084): il filo con il cliente per tutta la squadra, il
 * modulo finché il contratto è attivo o in pausa, l'avviso se nessuno del cliente lo legge. Aprirla
 * segna come letti i messaggi del cliente (dopo il caricamento).
 */
export async function CareMessagesCard({
  ctx,
  subscriptionId,
  pages,
}: {
  readonly ctx: TenantContext;
  readonly subscriptionId: string;
  readonly pages: number;
}) {
  if (!hasPermission(ctx, 'care:messages')) return null;
  const thread = await getCareThread(ctx, subscriptionId, pages);
  const t = await getTranslations('care.messages');
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const items: MessageThreadItem[] = thread.messages.map((message) => ({
    id: message.id,
    side: message.authorKind === 'SHOP' ? 'own' : 'other',
    author:
      message.authorName ?? (message.authorKind === 'SHOP' ? ctx.tenantName : t('deletedAccount')),
    body: message.body,
    photo: message.photoId
      ? {
          thumbUrl: routes.subscriptions.messagePhoto(subscriptionId, message.photoId, {
            thumb: true,
          }),
          fullUrl: routes.subscriptions.messagePhoto(subscriptionId, message.photoId),
        }
      : null,
    photoGone: message.photoGone,
    at: message.createdAt,
    highlight: message.unread,
    removePhoto:
      thread.canRemovePhotos && message.photoId
        ? removeCareMessagePhotoAction.bind(null, slug, subscriptionId, message.id)
        : null,
  }));
  return (
    <Card id="mensajes" className="scroll-mt-20" data-testid="care-messages-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {thread.open && thread.accessCount === 0 ? (
          <Alert variant="info">
            <AlertDescription>{t('noAccess')}</AlertDescription>
          </Alert>
        ) : null}
        {thread.hasOlder && pages < CARE_MESSAGE_LIMITS.maxPages ? (
          <Link
            href={routes.subscriptions.thread(subscriptionId, { mensajes: pages + 1 })}
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
            id="care-message"
            action={postCareMessageAction.bind(null, slug, subscriptionId)}
            maxSide={PHOTO_LIMITS.clientMaxSide}
            maxLength={CARE_MESSAGE_LIMITS.body}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('closed')}</p>
        )}
        {thread.unreadCount > 0 ? (
          <MarkThreadRead action={markCareThreadReadAction.bind(null, slug, subscriptionId)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
