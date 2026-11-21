import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MX_REGIONS, MX_TIMEZONES } from '@floral/domain';
import { Logo } from '@/components/brand/logo';
import { requireUser } from '@/lib/session';
import { createTenantAction } from './actions';
import { OnboardingForm } from './onboarding-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('title') };
}

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const t = await getTranslations();
  const timezones = MX_TIMEZONES.map((id) => ({ id, label: t(`timezones.${id}`) }));

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto max-w-2xl px-4 pt-8 pb-2">
        <Link href="/app" className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-16">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('onboarding.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('onboarding.subtitle')}</p>
        <OnboardingForm
          action={createTenantAction}
          timezones={timezones}
          regions={MX_REGIONS.map((region) => ({ code: region.code, name: region.name }))}
          defaultContactEmail={user.email}
        />
      </main>
    </div>
  );
}
