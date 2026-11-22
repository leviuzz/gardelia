import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto flex w-full max-w-md flex-wrap items-center justify-between gap-2 px-4 pt-8 pb-4">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16">{children}</main>
    </div>
  );
}
