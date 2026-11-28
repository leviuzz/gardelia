import 'server-only';
import { ArrowRight, Banknote, Globe, MessageSquare, Receipt, Sprout, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { countUnreadCareMessages, getOrderInbox, type TenantContext } from '@floral/core';
import { pendingOrderDeadlineShown } from '@floral/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';

/**
 * «Da gestire» in cima alla Home (M3, ADR-088): solo le righe che hanno qualcosa, ognuna con il suo
 * link — gli ordini online da accettare (con la prima scadenza), quelli tornati dopo un «No,
 * gracias» ai cambi (M3-2), i messaggi da leggere degli ordini e quelli di Floral Care e, per chi
 * gestisce i soldi, le prove di pagamento da controllare e i contanti da confermare (M3-3). Niente
 * se non c'è niente. Gli ordini che aspettano la conferma di chi compra non sono da gestire.
 */
export async function TodoCard({ ctx }: { readonly ctx: TenantContext }) {
  const [inbox, care] = await Promise.all([getOrderInbox(ctx), countUnreadCareMessages(ctx)]);
  const t = await getTranslations('dashboard.todo');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const rows: TodoRowProps[] = [];
  if (inbox.pendingOnline > 0) {
    rows.push({
      testId: 'todo-pending',
      icon: <Globe />,
      text: t('pending', { count: inbox.pendingOnline }),
      detail: inbox.firstDeadline
        ? t('pendingDeadline', {
            date: format.dateTime(pendingOrderDeadlineShown(inbox.firstDeadline), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: ctx.timezone,
            }),
          })
        : null,
      href: routes.orders.list({ when: 'pending' }),
      link: t('pendingLink'),
    });
  }
  if (inbox.declinedChanges > 0) {
    rows.push({
      testId: 'todo-declined-changes',
      icon: <X />,
      text: t('declinedChanges', { count: inbox.declinedChanges }),
      detail: null,
      href: routes.orders.list({ when: 'all', changes: 'declined' }),
      link: t('declinedChangesLink'),
    });
  }
  if (inbox.unreadMessages > 0) {
    rows.push({
      testId: 'todo-order-messages',
      icon: <MessageSquare />,
      text: t('orderMessages', { unread: inbox.unreadMessages, orders: inbox.unreadOrders }),
      detail: null,
      href: routes.orders.list({ when: 'all', messages: 'unread' }),
      link: t('orderMessagesLink'),
    });
  }
  // M3-3: i numeri arrivano solo a chi gestisce i soldi (0 per gli altri).
  if (inbox.pendingProofs > 0) {
    rows.push({
      testId: 'todo-payment-proofs',
      icon: <Receipt />,
      text: t('paymentProofs', { count: inbox.pendingProofs }),
      detail: null,
      href: routes.orders.list({ when: 'all', money: 'proofs' }),
      link: t('paymentProofsLink'),
    });
  }
  if (inbox.pendingCash > 0) {
    rows.push({
      testId: 'todo-cash',
      icon: <Banknote />,
      text: t('cash', { count: inbox.pendingCash }),
      detail: null,
      href: routes.orders.list({ when: 'all', money: 'cash' }),
      link: t('cashLink'),
    });
  }
  if (care && care.unread > 0) {
    rows.push({
      testId: 'todo-care-messages',
      icon: <Sprout />,
      text: t('careMessages', { unread: care.unread, threads: care.threads }),
      detail: null,
      href: routes.subscriptions.messages(),
      link: t('careMessagesLink'),
    });
  }
  if (rows.length === 0) return null;
  return (
    <Card data-testid="todo-card" className="border-primary/30">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => (
            <TodoRow key={row.testId} {...row} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface TodoRowProps {
  readonly testId: string;
  readonly icon: ReactNode;
  readonly text: string;
  readonly detail: string | null;
  readonly href: string;
  readonly link: string;
}

function TodoRow({ testId, icon, text, detail, href, link }: TodoRowProps) {
  return (
    <li data-testid={testId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary [&_svg]:size-4"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 basis-40 text-sm">
        <span id={`${testId}-text`} className="block font-medium">
          {text}
        </span>
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </span>
      {/* Più righe hanno lo stesso link («Ver pedidos»): la riga lo descrive a chi usa un lettore. */}
      <Link
        href={href}
        aria-describedby={`${testId}-text`}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {link}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </li>
  );
}
