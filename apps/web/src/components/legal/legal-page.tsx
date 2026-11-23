import { Languages } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE } from '@floral/domain';
import { BuyerHeader } from '@/components/public/buyer-header';
import { LegalDocument } from './legal-document';
import { LegalLinks } from './legal-links';

/**
 * Pagina di un documento legale (ADR-068). I testi sono in spagnolo, la lingua del mercato: chi
 * usa l'app in un'altra lingua lo legge in cima.
 */
export async function LegalPage({
  markdown,
  audience,
}: {
  readonly markdown: string;
  readonly audience: 'buyer' | 'florist';
}) {
  const t = await getTranslations('legal');
  const locale = await getLocale();
  return (
    <div className="min-h-dvh">
      <BuyerHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16">
        {locale === DEFAULT_LOCALE ? null : (
          <p className="mb-6 flex items-center gap-2 rounded-xl border bg-card p-3 text-sm text-muted-foreground">
            <Languages className="size-4 shrink-0" aria-hidden="true" />
            {t('spanishOnly')}
          </p>
        )}
        <div lang="es-MX">
          <LegalDocument markdown={markdown} />
        </div>
      </main>
      <footer className="pb-8">
        <LegalLinks audience={audience} />
      </footer>
    </div>
  );
}
