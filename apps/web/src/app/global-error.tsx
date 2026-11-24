'use client';

import { useEffect, useState } from 'react';
import { isStaleVersionError, reloadPage } from '@/lib/stale-version';
import './globals.css';

type ErrorTexts = {
  errorTitle: string;
  errorBody: string;
  errorReference: string;
  retry: string;
  staleVersion: { title: string; body: string; reload: string };
};

/**
 * Ultima difesa: errore nel layout radice. Qui non ci sono provider (traduzioni, font): i testi
 * arrivano da `messages/es-MX.json`, caricato solo in questo caso per non appesantire le pagine.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [texts, setTexts] = useState<ErrorTexts | null>(null);

  useEffect(() => {
    void import('../../messages/es-MX.json').then((messages) => setTexts(messages.default.errors));
  }, []);

  return (
    <html lang="es-MX">
      <body className="min-h-dvh">
        <main
          role="alert"
          className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
        >
          {texts && isStaleVersionError(error) ? (
            // Pagina aperta prima di un rilascio: si ricarica per avere la versione nuova.
            <>
              <h1 className="font-display text-2xl font-semibold">{texts.staleVersion.title}</h1>
              <p className="text-muted-foreground">{texts.staleVersion.body}</p>
              <button
                type="button"
                onClick={reloadPage}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                {texts.staleVersion.reload}
              </button>
            </>
          ) : texts ? (
            <>
              <h1 className="font-display text-2xl font-semibold">{texts.errorTitle}</h1>
              <p className="text-muted-foreground">{texts.errorBody}</p>
              {error.digest ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {texts.errorReference.replace('{digest}', error.digest)}
                </p>
              ) : null}
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                {texts.retry}
              </button>
            </>
          ) : null}
        </main>
      </body>
    </html>
  );
}
