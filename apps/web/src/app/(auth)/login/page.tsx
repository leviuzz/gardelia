import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { getSession, safeNextPath } from '@/lib/session';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  if (await getSession()) redirect(next);

  const t = await getTranslations('auth');
  return (
    <AuthCard
      title={t('loginTitle')}
      subtitle={t('loginSubtitle')}
      footer={
        <>
          {t('noAccount')}{' '}
          <Link
            href={next === '/app' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`}
            className="font-medium text-primary hover:underline"
          >
            {t('goToSignup')}
          </Link>
        </>
      }
    >
      <LoginForm next={next} defaultEmail={typeof params.email === 'string' ? params.email : ''} />
    </AuthCard>
  );
}
