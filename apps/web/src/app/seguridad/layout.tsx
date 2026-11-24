import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';

/** Cornice della sicurezza del conto (ADR-077): vale per fioristi e per chi compra. */
export default function SecurityLayout({ children }: LayoutProps<'/seguridad'>) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 pt-8 pb-2">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-10">{children}</main>
    </div>
  );
}
