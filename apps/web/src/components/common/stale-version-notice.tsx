'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { reloadPage } from '@/lib/stale-version';

/**
 * Al posto di "Algo salió mal" quando la pagina è rimasta alla versione precedente di Gardelia
 * (aperta prima di un rilascio): spiega cosa è successo e offre l'unica cosa che serve, ricaricare.
 */
export function StaleVersionNotice() {
  const t = useTranslations('errors.staleVersion');
  return (
    <div
      role="alert"
      data-testid="stale-version"
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-info-soft text-primary">
        <RefreshCw className="size-6" aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Button onClick={reloadPage}>
        <RefreshCw aria-hidden="true" />
        {t('reload')}
      </Button>
    </div>
  );
}
