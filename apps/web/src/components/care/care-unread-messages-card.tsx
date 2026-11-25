import 'server-only';
import { ArrowRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { countUnreadCareMessages, type TenantContext } from '@floral/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';

/**
 * Riquadro «Mensajes sin leer» del pannello (ADR-084): quanti messaggi dei clienti di Floral Care
 * aspettano e in quanti contratti, con il link a «Mensajes». Solo se ce ne sono.
 */
export async function CareUnreadMessagesCard({ ctx }: { readonly ctx: TenantContext }) {
  const unread = await countUnreadCareMessages(ctx);
  if (!unread || unread.unread === 0) return null;
  const t = await getTranslations('care.messagesCard');
  const routes = tenantRoutes(ctx.tenantSlug);
  return (
    <Card data-testid="care-unread-messages">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <Link
          href={routes.subscriptions.messages()}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {t('link')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {t('body', { unread: unread.unread, threads: unread.threads })}
      </CardContent>
    </Card>
  );
}
