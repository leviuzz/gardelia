import { CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { LegalLinks } from '@/components/legal/legal-links';
import { Button } from '@/components/ui/button';
import { buyerRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.privacy');
  return { title: t('deletedTitle'), robots: { index: false, follow: false } };
}

/** Dopo la cancellazione del conto (ADR-068): pagina pubblica, la sessione non c'è più. */
export default async function AccountDeletedPage() {
  const t = await getTranslations('account.privacy');
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto max-w-2xl px-4 pt-8 pb-2">
        <Link href={buyerRoutes.home} className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-10">
        <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <CircleCheck className="size-8 text-primary" aria-hidden="true" />
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t('deletedTitle')}
          </h1>
          <p className="text-muted-foreground">{t('deletedBody')}</p>
          <Button asChild variant="outline">
            <Link href={buyerRoutes.home}>{t('backHome')}</Link>
          </Button>
        </div>
      </main>
      <footer className="pb-8">
        <LegalLinks audience="buyer" />
      </footer>
    </div>
  );
}
