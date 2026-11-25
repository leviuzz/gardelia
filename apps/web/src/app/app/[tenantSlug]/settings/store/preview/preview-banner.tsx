import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { tenantRoutes } from '@/lib/routes';

/**
 * Sopra l'anteprima della vetrina (M1-2): che cosa si sta guardando, se il negozio non è ancora
 * pubblicato, e il ritorno a Impostazioni → Negozio online. Nella lingua di chi usa l'app; la
 * vetrina sotto resta nella lingua del negozio, come la vedono i clienti.
 */
export async function PreviewBanner({
  slug,
  isPublished,
}: {
  readonly slug: string;
  readonly isPublished: boolean;
}) {
  const t = await getTranslations('store.preview');
  return (
    <div className="space-y-3" data-testid="store-preview-banner">
      <Link
        href={tenantRoutes(slug).settings.store}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <Alert variant={isPublished ? 'info' : 'warning'}>
        {isPublished ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        <AlertDescription>
          <p className="font-medium">{t('banner')}</p>
          {isPublished ? null : <p>{t('notPublished')}</p>}
        </AlertDescription>
      </Alert>
    </div>
  );
}
