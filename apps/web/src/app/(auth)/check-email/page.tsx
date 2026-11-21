import { Mail } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { ResendVerification } from '@/components/auth/resend-verification';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('checkEmailTitle') };
}

export default async function CheckEmailPage({ searchParams }: PageProps<'/check-email'>) {
  const params = await searchParams;
  const email = typeof params.email === 'string' ? params.email : '';
  const t = await getTranslations('auth');
  return (
    <AuthCard
      title={t('checkEmailTitle')}
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('goToLogin')}
        </Link>
      }
    >
      <div className="space-y-5">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Mail className="size-6" aria-hidden="true" />
        </div>
        <p className="leading-relaxed">{t('checkEmailBody')}</p>
        <p className="text-sm text-muted-foreground">{t('checkEmailHint')}</p>
        <ResendVerification defaultEmail={email} next="/app" />
      </div>
    </AuthCard>
  );
}
