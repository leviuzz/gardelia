import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { getSession, safeNextPath } from '@/lib/session';
import { SignupForm } from './signup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signupTitle') };
}

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  if (await getSession()) redirect(next);

  const t = await getTranslations('auth');
  return (
    <AuthCard
      title={t('signupTitle')}
      subtitle={t('signupSubtitle')}
      footer={
        <>
          {t('haveAccount')}{' '}
          <Link
            href={next === '/app' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
            className="font-medium text-primary hover:underline"
          >
            {t('goToLogin')}
          </Link>
        </>
      }
    >
      <SignupForm next={next} defaultEmail={typeof params.email === 'string' ? params.email : ''} />
    </AuthCard>
  );
}
