import 'server-only';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { countUnreadCareMessages, hasPermission, type TenantContext } from '@floral/core';
import { tenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Le schede di Floral Care: «Contratos», «Cobros» (ADR-082, solo per chi gestisce i soldi) e
 * «Mensajes» (ADR-084, per tutta la squadra), con il numero dei messaggi del cliente da leggere nel
 * colore di ciò che aspetta. Nessuna scheda se ne resterebbe una sola.
 */
export async function CareTabs({
  ctx,
  current,
}: {
  readonly ctx: TenantContext;
  readonly current: 'contracts' | 'charges' | 'messages';
}) {
  const charges = hasPermission(ctx, 'subscriptions:payments');
  const messages = await countUnreadCareMessages(ctx);
  if (!charges && !messages) return null;
  const t = await getTranslations('care.tabs');
  const routes = tenantRoutes(ctx.tenantSlug);
  const unread = messages?.unread ?? 0;
  const tabs = [
    { key: 'contracts', href: routes.subscriptions.list(), label: t('contracts'), alert: false },
    ...(charges
      ? [
          {
            key: 'charges',
            href: routes.subscriptions.charges(),
            label: t('charges'),
            alert: false,
          } as const,
        ]
      : []),
    ...(messages
      ? [
          {
            key: 'messages',
            href: routes.subscriptions.messages(),
            label: unread > 0 ? t('messagesCount', { count: unread }) : t('messages'),
            alert: unread > 0,
          } as const,
        ]
      : []),
  ] as const;
  return (
    <nav
      aria-label={t('label')}
      className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit print:hidden"
      data-testid="care-tabs"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'flex-1 rounded-lg px-2.5 py-1.5 text-center text-sm font-medium whitespace-nowrap transition-colors sm:flex-none sm:px-4',
            current === tab.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
            tab.alert && current !== tab.key && 'text-[oklch(0.45_0.17_27)]',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
