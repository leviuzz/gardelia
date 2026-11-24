'use client';

import { useTranslations } from 'next-intl';
import { StaleVersionNotice } from '@/components/common/stale-version-notice';
import { Button } from '@/components/ui/button';
import { isStaleVersionError } from '@/lib/stale-version';

/** Errore di rendering: nessun dettaglio tecnico mostrato; il digest correla con i log del server. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  // Pagina aperta prima di un rilascio: basta ricaricarla per avere la versione nuova.
  if (isStaleVersionError(error)) {
    return (
      <main className="flex min-h-[70dvh] items-center justify-center">
        <StaleVersionNotice />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-semibold">{t('errorTitle')}</h1>
      <p className="text-muted-foreground">{t('errorBody')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          {t('errorReference', { digest: error.digest })}
        </p>
      ) : null}
      <Button onClick={reset}>{t('retry')}</Button>
    </main>
  );
}
