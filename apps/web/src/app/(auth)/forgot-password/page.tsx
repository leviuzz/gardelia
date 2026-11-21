import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from './forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('forgotTitle') };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <AuthCard
      title={t('forgotTitle')}
      subtitle={t('forgotSubtitle')}
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('goToLogin')}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
