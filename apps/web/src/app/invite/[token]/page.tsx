import { Store } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getInvitationPreview } from '@floral/core';
import { normalizeEmail } from '@floral/domain';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthDivider, GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Logo } from '@/components/brand/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authPath } from '@/lib/auth-paths';
import { isGoogleLoginEnabled } from '@/lib/env';
import { tenantRoutes } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { acceptInvitationAction } from './actions';
import { AcceptInvitationForm } from './accept-form';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const [preview, session, t] = await Promise.all([
    getInvitationPreview(token),
    getSession(),
    getTranslations(),
  ]);
  const invitePath = `/invite/${token}`;

  let content: React.ReactNode;
  if (preview.status !== 'PENDING' || !preview.email || !preview.role) {
    const reason =
      preview.status === 'EXPIRED'
        ? t('invite.expired')
        : preview.status === 'REVOKED'
          ? t('invite.revoked')
          : preview.status === 'ACCEPTED'
            ? t('invite.accepted')
            : t('invite.invalid');
    content = (
      <AuthCard title={t('invite.invalidTitle')}>
        <div className="space-y-5">
          <Alert variant={preview.status === 'ACCEPTED' ? 'info' : 'destructive'}>
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link
              href={
                preview.status === 'ACCEPTED' && preview.tenantSlug
                  ? tenantRoutes(preview.tenantSlug).home
                  : '/'
              }
            >
              {preview.status === 'ACCEPTED' ? t('invite.goToShop') : t('errors.goHome')}
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  } else {
    const intro = (
      <div className="mb-6 flex items-start gap-3 rounded-xl bg-muted/60 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Store className="size-5" aria-hidden="true" />
        </span>
        <div className="text-sm leading-relaxed">
          <p>
            {t('invite.body', {
              inviter: preview.inviterName ?? '—',
              role: t(`roles.${preview.role}`),
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {t('invite.forEmail', { email: preview.email })}
          </p>
        </div>
      </div>
    );
    const title = t('invite.title', { shop: preview.tenantName ?? '' });

    if (!session) {
      content = (
        <AuthCard title={title}>
          {intro}
          <div className="space-y-3">
            <p className="text-sm">{t('invite.loginToAccept', { email: preview.email })}</p>
            {isGoogleLoginEnabled() ? (
              <>
                {/* Gli errori del ritorno da Google si mostrano nella pagina di accesso. */}
                <GoogleSignInButton
                  callbackURL={invitePath}
                  errorCallbackURL={authPath('/login', { next: invitePath, email: preview.email })}
                  loginHint={preview.email}
                />
                <AuthDivider label={t('auth.google.divider')} />
              </>
            ) : null}
            <Button asChild size="lg" className="w-full">
              <Link href={authPath('/login', { next: invitePath, email: preview.email })}>
                {t('auth.loginButton')}
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={authPath('/signup', { next: invitePath, email: preview.email })}>
                {t('invite.signupToAccept')}
              </Link>
            </Button>
          </div>
        </AuthCard>
      );
    } else if (normalizeEmail(session.user.email) !== preview.email) {
      content = (
        <AuthCard title={title}>
          {intro}
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertDescription>
                {t('invite.wrongAccount', { current: session.user.email, email: preview.email })}
              </AlertDescription>
            </Alert>
            <SignOutButton
              label={t('invite.switchAccount')}
              redirectTo={`/login?next=${encodeURIComponent(invitePath)}`}
            />
          </div>
        </AuthCard>
      );
    } else {
      content = (
        <AuthCard title={title}>
          {intro}
          <AcceptInvitationForm action={acceptInvitationAction.bind(null, token)} />
        </AuthCard>
      );
    }
  }

  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto w-full max-w-md px-4 pt-8 pb-4">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-16">{content}</main>
    </div>
  );
}
