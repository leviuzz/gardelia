'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Errore di rendering: nessun dettaglio tecnico mostrato; il digest correla con i log del server. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors');
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-semibold">{t('errorTitle')}</h1>
      <p className="text-muted-foreground">{t('errorBody')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">{t('errorReference', { digest: error.digest })}</p>
      ) : null}
      <Button onClick={reset}>{t('retry')}</Button>
    </main>
  );
}
