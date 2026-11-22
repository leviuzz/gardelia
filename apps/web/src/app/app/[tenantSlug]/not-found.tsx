'use client';

import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Risorsa non trovata in una pagina della fioreria (anche un ID di un'altra fioreria: sempre 404,
 * mai 403). Compare dentro il menu della fioreria, che resta utilizzabile.
 */
export default function TenantNotFound() {
  const t = useTranslations('errors');
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="size-6" aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl font-semibold">{t('pageNotFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('notFound')}</p>
      <Button asChild>
        <Link href={`/app/${tenantSlug}`}>{t('goHome')}</Link>
      </Button>
    </div>
  );
}
