import { Flower2, ListChecks, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { LegalLinks } from '@/components/legal/legal-links';
import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing');
  return { title: t('metaTitle') };
}

/**
 * Pagina per i fioristi (ADR-066): la presentazione del gestionale, spostata qui da `/` quando la
 * home è diventata quella di chi compra fiori.
 */
export default async function LandingPage() {
  const t = await getTranslations('landing');
  const tAuth = await getTranslations('auth');
  const session = await getSession();

  const features = [
    { icon: Flower2, title: t('feature1Title'), body: t('feature1Body') },
    { icon: ListChecks, title: t('feature2Title'), body: t('feature2Body') },
    { icon: ShieldCheck, title: t('feature3Title'), body: t('feature3Body') },
  ];

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10rem] size-[36rem] rounded-full bg-[radial-gradient(circle,oklch(0.93_0.04_12/0.9),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-12rem] left-[-8rem] size-[32rem] rounded-full bg-[radial-gradient(circle,oklch(0.93_0.04_150/0.8),transparent_65%)]"
      />
      <div className="relative mx-auto flex max-w-6xl justify-end px-4 pt-3 sm:px-6">
        <LanguageSwitcher />
      </div>
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label={t('buyerHome')}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          {session ? (
            <Button asChild>
              <Link href="/app">{tAuth('loginButton')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/login">{t('ctaSecondary')}</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">{t('ctaPrimary')}</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pt-12 pb-20 sm:px-6 sm:pt-20">
        <section className="max-w-3xl">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">
            {t('eyebrow')}
          </p>
          <h1 className="mt-4 font-display text-4xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
            {t('title')}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {t('subtitle')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={session ? '/app' : '/signup'}>
                {session ? tAuth('loginButton') : t('ctaPrimary')}
              </Link>
            </Button>
            {session ? null : (
              <Button asChild size="lg" variant="outline">
                <Link href="/login">{t('ctaSecondary')}</Link>
              </Button>
            )}
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border bg-card/80 p-6 shadow-xs backdrop-blur">
              <div className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                <Icon className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
        <p className="mt-8 text-sm text-muted-foreground">{t('roadmapNote')}</p>
      </main>
      <footer className="pb-8">
        <LegalLinks audience="florist" />
      </footer>
    </div>
  );
}
