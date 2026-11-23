import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { legalRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Collegamenti ai documenti legali (ADR-068) per i piè di pagina: chi compra vede i suoi termini,
 * le fiorerie i loro; l'aviso de privacidad è uno per tutti. `locale`: per le pagine nella lingua
 * del mercato della fioreria.
 */
export async function LegalLinks({
  audience,
  locale,
  className,
}: {
  readonly audience: 'buyer' | 'florist';
  readonly locale?: string;
  readonly className?: string;
}) {
  const t = locale
    ? await getTranslations({ locale, namespace: 'legal' })
    : await getTranslations('legal');
  return (
    <nav
      aria-label={t('linksLabel')}
      className={cn(
        'flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <Link href={legalRoutes.privacy} className="hover:text-foreground hover:underline">
        {t('privacy')}
      </Link>
      <Link
        href={audience === 'buyer' ? legalRoutes.buyerTerms : legalRoutes.terms}
        className="hover:text-foreground hover:underline"
      >
        {audience === 'buyer' ? t('buyerTerms') : t('terms')}
      </Link>
    </nav>
  );
}
