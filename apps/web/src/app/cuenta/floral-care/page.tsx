import { ArrowLeft, CalendarClock, ChevronRight, Leaf, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listMyCareContracts } from '@floral/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.care');
  return { title: t('title') };
}

/**
 * "Mi Floral Care" (ADR-084): i servizi di cura delle piante che la persona segue, fra tutte le
 * fiorerie. Gli aperti prima; uno finito resta in sola lettura finché si cancellano le foto.
 */
export default async function MyFloralCarePage() {
  const ctx = await getBuyerContext(accountRoutes.care.home);
  const contracts = await listMyCareContracts(ctx);
  const t = await getTranslations();
  const format = await getFormatter();
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.home}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.backAccount')}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('account.care.title')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('account.care.subtitle')}</p>
      </div>
      {contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6 sm:flex-row sm:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <Leaf className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm text-muted-foreground">{t('account.care.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="my-care-contracts">
          {contracts.map((contract) => (
            <li key={contract.subscriptionId}>
              <Link
                href={accountRoutes.care.contract(contract.subscriptionId)}
                className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  <Leaf className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block font-medium break-words">{contract.shopName}</span>
                  <span className="block text-sm break-words text-muted-foreground">
                    {[contract.siteLabel ?? contract.customerName, contract.siteLine]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {contract.readOnly ? (
                      <Badge variant="outline">{t('account.care.ended')}</Badge>
                    ) : contract.nextVisit ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground first-letter:uppercase">
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {t('account.care.nextVisit', {
                          when: contract.nextVisit.start
                            ? `${day(contract.nextVisit.date)} · ${contract.nextVisit.start}`
                            : day(contract.nextVisit.date),
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('account.care.noNextVisit')}</span>
                    )}
                    {contract.dueMinor !== null && contract.dueMinor > 0 ? (
                      <Badge variant="secondary">
                        {t('account.care.due', {
                          amount: money(contract.dueMinor, contract.currency),
                        })}
                      </Badge>
                    ) : null}
                    {contract.unreadMessages > 0 ? (
                      <Badge variant="info">
                        <MessageSquare className="size-3" aria-hidden="true" />
                        {t('account.care.unread', { count: contract.unreadMessages })}
                      </Badge>
                    ) : null}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
