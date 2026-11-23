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
import { isAccountPath, legalRoutes } from '@/lib/routes';
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
  const tLegal = await getTranslations('legal');
  const buyer = isAccountPath(next);
  const linkClass = 'font-medium text-primary hover:underline';
  const email = typeof params.email === 'string' ? params.email : '';
  const oauthError = oauthErrorKey(params.error);
  return (
    <AuthCard
      title={t('signupTitle')}
      // Chi arriva per "Mi cuenta" compra fiori; altrimenti apre una fioreria.
      subtitle={buyer ? t('signupSubtitleBuyer') : t('signupSubtitle')}
      footer={
        <>
          {t('haveAccount')}{' '}
          <Link
            href={authPath('/login', { next })}
            className="font-medium text-primary hover:underline"
          >
            {t('goToLogin')}
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
              errorCallbackURL={authPath('/signup', { next, email })}
              loginHint={email || undefined}
            />
            <AuthDivider label={t('google.divider')} />
          </>
        ) : null}
        <SignupForm next={next} defaultEmail={email} />
        {/* Vale anche per "Continuar con Google": crea un account allo stesso modo (ADR-068). */}
        <p className="text-center text-xs text-muted-foreground">
          {tLegal.rich('signupNotice', {
            terms: (chunks) => (
              <Link href={buyer ? legalRoutes.buyerTerms : legalRoutes.terms} className={linkClass}>
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href={legalRoutes.privacy} className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </AuthCard>
  );
}
