import 'server-only';
import { Leaf, MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getAssistantCreditsPanel, type TenantContext } from '@floral/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { aiCreditsWhatsappLink } from '@/lib/platform-contact';

/**
 * Ajustes → Floral Care, «Asistente de plantas para tus clientes» (ADR-085, blocco 6b): i crediti
 * comprati da Gardelia, dati ai servizi e disponibili, e «Comprar créditos por WhatsApp» per chi li
 * può dare. Il prezzo non sta nel codice (D-16/17): lo dice la piattaforma quando si comprano.
 */
export async function AssistantCreditsSettingsCard({ ctx }: { readonly ctx: TenantContext }) {
  const panel = await getAssistantCreditsPanel(ctx);
  const t = await getTranslations();
  const buyLink = panel.canGive
    ? aiCreditsWhatsappLink(t('care.assistant.settings.buyText', { shop: ctx.tenantName }))
    : null;
  const stats = [
    { key: 'purchased', value: panel.purchased },
    { key: 'allocated', value: panel.allocated },
    { key: 'remaining', value: panel.remaining },
  ] as const;

  return (
    <Card data-testid="assistant-credits-settings">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Leaf className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('care.assistant.settings.title')}
          {panel.simulated ? (
            <Badge variant="warning">{t('assistant.simulatedBadge')}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{t('care.assistant.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {panel.available ? null : (
          <Alert variant="info">
            <AlertDescription>{t('care.assistant.settings.notAvailable')}</AlertDescription>
          </Alert>
        )}
        <p>{t('care.assistant.settings.rule')}</p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {stats.map((stat) => (
            <div key={stat.key} className="rounded-xl bg-muted/50 p-2">
              <dt className="text-xs text-muted-foreground">
                {t(`care.assistant.settings.${stat.key}`)}
              </dt>
              <dd
                className="text-lg font-semibold tabular-nums"
                data-testid={`assistant-shop-${stat.key}`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground">{t('care.assistant.settings.howTo')}</p>
        {panel.canGive ? (
          buyLink ? (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={buyLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                {t('care.assistant.settings.buy')}
              </a>
            </Button>
          ) : (
            <p className="text-muted-foreground">{t('care.assistant.settings.noContact')}</p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
