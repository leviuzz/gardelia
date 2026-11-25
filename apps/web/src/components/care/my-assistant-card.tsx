import 'server-only';
import { Leaf, MessageSquarePlus, Plus } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getMyAssistant, type BuyerContext } from '@floral/core';
import type { SupportedLocale } from '@floral/domain';
import { askMoreAssistantCreditsAction } from '@/app/cuenta/floral-care/[subscriptionId]/asistente/actions';
import { ActionButton } from '@/components/form/action-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountRoutes } from '@/lib/routes';

/**
 * «Asistente de plantas» nella pagina del contratto di Mi Floral Care (ADR-085, blocco 6b): le
 * consultas che restano, «Nueva consulta» e le ultime della persona; senza crediti, «Pedir
 * consultas» alla fioreria. Non c'è se l'assistente non è configurato, né a contratto finito senza
 * consultas da rileggere.
 */
export async function MyAssistantCard({
  ctx,
  subscriptionId,
  locale,
}: {
  readonly ctx: BuyerContext;
  readonly subscriptionId: string;
  readonly locale: SupportedLocale;
}) {
  const data = await getMyAssistant(ctx, subscriptionId, locale);
  if (!data.available || (!data.open && data.cases.length === 0)) return null;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const routes = accountRoutes.care;
  const when = (date: Date) =>
    format.dateTime(date, { dateStyle: 'medium', timeZone: data.shopTimeZone });
  const first = data.credits.allocated === 0;

  return (
    <Card data-testid="my-assistant">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Leaf className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('assistant.title')}
          {data.simulated ? <Badge variant="warning">{t('assistant.simulatedBadge')}</Badge> : null}
        </CardTitle>
        <CardDescription>{t('assistant.sectionDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.open ? (
          <p className="font-medium" data-testid="my-assistant-credits">
            {t('assistant.credits', { count: data.credits.remaining })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('assistant.closed')}</p>
        )}
        {data.open && data.credits.remaining === 0 ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {first
                ? t('assistant.none', { shop: data.shopName })
                : t('assistant.noCredits', { shop: data.shopName })}
            </p>
            <ActionButton
              action={askMoreAssistantCreditsAction.bind(null, subscriptionId)}
              variant="outline"
              className="w-full sm:w-auto sm:justify-self-start"
              icon={<MessageSquarePlus aria-hidden="true" />}
            >
              {first ? t('assistant.more.first') : t('assistant.more.action')}
            </ActionButton>
          </div>
        ) : null}
        {data.open && data.credits.remaining > 0 ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href={routes.assistant(subscriptionId)}>
              <Plus aria-hidden="true" />
              {t('assistant.new.title')}
            </Link>
          </Button>
        ) : null}
        {data.cases.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('assistant.new.recentTitle')}</p>
            <ul className="divide-y rounded-xl border text-sm">
              {data.cases.map((item) => (
                <li key={item.id}>
                  <Link
                    href={routes.assistant(subscriptionId, { caso: item.id })}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted"
                  >
                    <span className="min-w-0 font-medium break-words">
                      {item.speciesName ?? t('assistant.new.unknownSpecies')}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {t('assistant.new.answers', { count: item.answers })}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{when(item.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={routes.assistant(subscriptionId)}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t('assistant.seeAll')}
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
