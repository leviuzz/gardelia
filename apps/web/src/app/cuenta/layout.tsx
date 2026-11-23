import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';

/** Cornice del conto cliente (blocco C1): come l'onboarding, senza il menu della fioreria. */
export default function AccountLayout({ children }: LayoutProps<'/cuenta'>) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 pt-8 pb-2">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-16">{children}</main>
    </div>
  );
}
