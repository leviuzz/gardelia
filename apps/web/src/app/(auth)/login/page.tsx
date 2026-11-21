import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthDivider, GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { OAuthErrorAlert } from '@/components/auth/oauth-error-alert';
import { authPath } from '@/lib/auth-paths';
import { isGoogleLoginEnabled } from '@/lib/env';
import { oauthErrorKey } from '@/lib/oauth-errors';
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
  const email = typeof params.email === 'string' ? params.email : '';
  const oauthError = oauthErrorKey(params.error);
  return (
    <AuthCard
      title={t('loginTitle')}
      subtitle={t('loginSubtitle')}
      footer={
        <>
          {t('noAccount')}{' '}
          <Link
            href={authPath('/signup', { next })}
            className="font-medium text-primary hover:underline"
          >
            {t('goToSignup')}
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        {oauthError ? <OAuthErrorAlert error={oauthError} /> : null}
        {isGoogleLoginEnabled() ? (
          <>
            <GoogleSignInButton
              callbackURL={next}
              errorCallbackURL={authPath('/login', { next, email })}
              loginHint={email || undefined}
            />
            <AuthDivider label={t('google.divider')} />
          </>
        ) : null}
        <LoginForm next={next} defaultEmail={email} />
      </div>
    </AuthCard>
  );
}
