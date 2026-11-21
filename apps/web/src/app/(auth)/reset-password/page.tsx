import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ResetPasswordForm } from './reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('resetTitle') };
}

export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  const t = await getTranslations('auth');

  if (!token || typeof params.error === 'string') {
    return (
      <AuthCard title={t('resetTitle')}>
        <div className="space-y-5">
          <Alert variant="destructive">
            <AlertDescription>{t('resetInvalid')}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/forgot-password">{t('requestNewLink')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('resetTitle')}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
