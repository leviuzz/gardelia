import 'server-only';
import { Leaf } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getContractAssistantCredits, type TenantContext } from '@floral/core';
import { giveAssistantCreditsAction } from '@/app/app/[tenantSlug]/subscriptions/[subscriptionId]/assistant-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { AssistantCreditsForm } from './assistant-credits-form';

/**
 * «Asistente de plantas» nella pagina del contratto (ADR-085, blocco 6b): crediti dati, usati e
 * rimasti, «Dar créditos» per proprietario e gerente (fino al saldo della fioreria), l'avviso se
 * nessuno del cliente entra in Mi Floral Care. La fioreria vede quante consultas, non che cosa.
 * Senza assistente configurato non c'è.
 */
export async function AssistantCreditsCard({
  ctx,
  subscriptionId,
}: {
  readonly ctx: TenantContext;
  readonly subscriptionId: string;
}) {
  const credits = await getContractAssistantCredits(ctx, subscriptionId);
  if (!credits.available) return null;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const routes = tenantRoutes(ctx.tenantSlug);
  const stats = [
    { key: 'given', value: credits.given },
    { key: 'used', value: credits.used },
    { key: 'remaining', value: credits.remaining },
  ] as const;

  return (
    <Card data-testid="assistant-credits-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Leaf className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('care.assistant.card.title')}
          {credits.simulated ? (
            <Badge variant="warning">{t('assistant.simulatedBadge')}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{t('care.assistant.card.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          {stats.map((stat) => (
            <div key={stat.key} className="rounded-xl bg-muted/50 p-2">
              <dt className="text-xs text-muted-foreground">
                {t(`care.assistant.card.${stat.key}`)}
              </dt>
              <dd
                className="text-lg font-semibold tabular-nums"
                data-testid={`assistant-credits-${stat.key}`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        {credits.lastUsedAt ? (
          <p className="text-xs text-muted-foreground">
            {t('care.assistant.card.lastUsed', {
              date: format.dateTime(credits.lastUsedAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: ctx.timezone,
              }),
            })}
          </p>
        ) : null}
        {credits.returned > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('care.assistant.card.returned', { count: credits.returned })}
          </p>
        ) : null}
        {credits.open && !credits.hasPortalAccess ? (
          <Alert variant="info">
            <AlertDescription>{t('care.assistant.card.noAccess')}</AlertDescription>
          </Alert>
        ) : null}
        {!credits.open ? (
          <p className="text-sm text-muted-foreground">{t('care.assistant.card.closed')}</p>
        ) : credits.canGive ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('care.assistant.card.shopRemaining', { count: credits.shopRemaining })}{' '}
              {credits.shopRemaining === 0 ? (
                <Link href={routes.settings.care} className="font-medium text-primary underline">
                  {t('care.assistant.card.buyHint')}
                </Link>
              ) : null}
            </p>
            {credits.shopRemaining > 0 ? (
              <AssistantCreditsForm
                action={giveAssistantCreditsAction.bind(null, ctx.tenantSlug, subscriptionId)}
                available={credits.shopRemaining}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('care.assistant.card.onlyManagers')}</p>
        )}
      </CardContent>
    </Card>
  );
}
