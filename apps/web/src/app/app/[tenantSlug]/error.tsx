'use client';

import { TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { startTransition } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Errore in una pagina della fioreria: il confine è DENTRO il layout, quindi menu, selettore della
 * fioreria e navigazione restano e l'utente può spostarsi altrove. Il riferimento (digest) è lo
 * stesso registrato nei log del server insieme all'ID della richiesta.
 */
export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const router = useRouter();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  function retry() {
    // Gli errori dei Server Component si risolvono solo chiedendo di nuovo la pagina al server.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-[oklch(0.42_0.16_27)]">
        <TriangleExclamationPoint className="size-6" aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl font-semibold">{t('errorTitle')}</h1>
      <p className="text-muted-foreground">{t('sectionErrorBody')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          {t('errorReference', { digest: error.digest })}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={retry}>{t('retry')}</Button>
        <Button asChild variant="outline">
          <Link href={`/app/${tenantSlug}`}>{t('goHome')}</Link>
        </Button>
      </div>
    </div>
  );
}
