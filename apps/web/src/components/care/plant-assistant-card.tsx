import 'server-only';
import { Plus, ScanSearch } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listAssistantCases, type TenantContext } from '@floral/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';

/**
 * «Asistente de plantas» nella pagina del contratto (ADR-085): «Nueva consulta» e le ultime
 * consultas. La pagina la mostra solo se l'assistente è configurato e il ruolo lo usa.
 */
export async function PlantAssistantCard({
  ctx,
  subscriptionId,
  canStart,
}: {
  readonly ctx: TenantContext;
  readonly subscriptionId: string;
  /** Contratto aperto (bozza, attivo o in pausa): si può fare una nuova consulta. */
  readonly canStart: boolean;
}) {
  const t = await getTranslations('assistant');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const cases = await listAssistantCases(ctx, subscriptionId, 3);
  return (
    <Card data-testid="assistant-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <ScanSearch className="size-5 text-primary" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        {canStart ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={routes.subscriptions.assistant(subscriptionId)}>
              <Plus aria-hidden="true" />
              {t('new.title')}
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('card.description')}</p>
        {cases.length === 0 ? (
          <p className="text-muted-foreground">{t('card.empty')}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {cases.map((item) => (
              <li key={item.id}>
                <Link
                  href={routes.subscriptions.assistant(subscriptionId, { case: item.id })}
                  className="grid gap-0.5 px-3 py-2 hover:bg-muted"
                >
                  <span className="font-medium break-words">
                    {item.speciesName ?? t('new.unknownSpecies')}
                    {item.plantName ? (
                      <span className="font-normal text-muted-foreground"> · {item.plantName}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(item.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      timeZone: ctx.timezone,
                    })}{' '}
                    · {t('new.answers', { count: item.answers })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
