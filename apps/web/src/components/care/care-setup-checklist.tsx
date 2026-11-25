import 'server-only';
import { CheckCircle2, Circle, Settings } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CareSetupStatusDto } from '@floral/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * «Antes del primer contrato» (ADR-075): i due passi di Ajustes → Floral Care che mancano per fare
 * un contratto, ognuno fatto o da fare, con il link per farli. Si vede nell'elenco dei contratti,
 * nella scelta del cliente e nel modulo del contratto finché l'offerta non è pronta.
 */
export async function CareSetupChecklist({
  status,
  settingsHref,
}: {
  readonly status: CareSetupStatusDto;
  readonly settingsHref: string;
}) {
  const t = await getTranslations('care.setup');
  const steps = [
    { key: 'tariffs', done: status.tariffsSaved && status.frequencies > 0 },
    { key: 'slots', done: status.activeSlots > 0 },
  ] as const;
  return (
    <Card data-testid="care-setup">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-3 text-sm">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0">
                <span className="block font-medium">
                  {index + 1}. {t(step.key)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {step.done ? t('done') : t('todo')}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {status.canWrite ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href={settingsHref}>
              <Settings aria-hidden="true" />
              {t('action')}
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('askManager')}</p>
        )}
      </CardContent>
    </Card>
  );
}
