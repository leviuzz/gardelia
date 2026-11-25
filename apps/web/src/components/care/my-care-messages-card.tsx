import 'server-only';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getMyCareThread, type BuyerContext } from '@floral/core';
import { CARE_MESSAGE_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import {
  markMyCareThreadReadAction,
  postMyCareMessageAction,
} from '@/app/cuenta/floral-care/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountRoutes } from '@/lib/routes';
import { MarkThreadRead } from './mark-thread-read';
import { MessageComposer } from './message-composer';
import { MessageThread, type MessageThreadItem } from './message-thread';

/**
 * «Mensajes con …» nella pagina del contratto di Mi Floral Care (ADR-084): il filo con la
 * fioreria (chi della fioreria ha scritto, come nei resoconti) e il modulo finché il contratto è
 * attivo o in pausa; a contratto finito si legge e basta. Aprirla toglie il "nuevo" ai messaggi
 * della fioreria (dopo il caricamento).
 */
export async function MyCareMessagesCard({
  ctx,
  subscriptionId,
  pages,
  timeZone,
}: {
  readonly ctx: BuyerContext;
  readonly subscriptionId: string;
  readonly pages: number;
  readonly timeZone: string;
}) {
  const thread = await getMyCareThread(ctx, subscriptionId, pages);
  const t = await getTranslations();
  const items: MessageThreadItem[] = thread.messages.map((message) => ({
    id: message.id,
    side: message.fromShop ? 'other' : 'own',
    author: message.mine
      ? t('care.messages.you')
      : (message.authorName ??
        (message.fromShop ? thread.shopName : t('care.messages.deletedAccount'))),
    body: message.body,
    photo: message.photoId
      ? {
          thumbUrl: accountRoutes.care.photo(subscriptionId, message.photoId, { thumb: true }),
          fullUrl: accountRoutes.care.photo(subscriptionId, message.photoId),
        }
      : null,
    photoGone: message.photoGone,
    at: message.createdAt,
    highlight: message.isNew,
    removePhoto: null,
  }));
  return (
    <Card id="mensajes" className="scroll-mt-20" data-testid="my-care-messages">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('account.care.messages.title', { shop: thread.shopName })}
        </CardTitle>
        {thread.open ? (
          <CardDescription>{t('account.care.messages.subtitle')}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {thread.hasOlder && pages < CARE_MESSAGE_LIMITS.maxPages ? (
          <Link
            href={accountRoutes.care.thread(subscriptionId, { mensajes: pages + 1 })}
            scroll={false}
            className="block text-center text-sm font-medium text-primary hover:underline"
          >
            {t('care.messages.older')}
          </Link>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('care.messages.empty')}</p>
        ) : (
          <MessageThread
            items={items}
            timeZone={timeZone}
            dividerLabel={t('care.messages.newDivider')}
          />
        )}
        {thread.open ? (
          <MessageComposer
            id="my-care-message"
            action={postMyCareMessageAction.bind(null, subscriptionId)}
            maxSide={PHOTO_LIMITS.clientMaxSide}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('account.care.messages.closed')}</p>
        )}
        {thread.newCount > 0 ? (
          <MarkThreadRead action={markMyCareThreadReadAction.bind(null, subscriptionId)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
