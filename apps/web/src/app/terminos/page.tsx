import type { Metadata } from 'next';
import { BRAND } from '@floral/domain';
import { legalTitle } from '@/components/legal/legal-document';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_TEXTS } from '@/content/legal.generated';

export const metadata: Metadata = {
  title: `${legalTitle(LEGAL_TEXTS.terms)} · ${BRAND.productName}`,
};

/** Documento legale (ADR-068): il testo di `docs/legal/`, bozza finché non lo rivede un avvocato. */
export default function TermsPage() {
  return <LegalPage markdown={LEGAL_TEXTS.terms} audience="florist" />;
}
