import { Leaf } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCarePortalInvitePreview } from '@floral/core';
import { normalizeEmail } from '@floral/domain';
import { AuthDivider, GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AcceptPortalInviteForm } from '@/components/care-portal/portal-forms';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authPath } from '@/lib/auth-paths';
import { carePortalSecret } from '@/lib/care-portal';
import { isGoogleLoginEnabled } from '@/lib/env';
import { accountRoutes } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { acceptCarePortalInviteAction } from '../../actions';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * L'invito di una fioreria a "Mi Floral Care" (ADR-084): si apre anche senza sessione. Si entra o
 * ci si registra con l'email dell'invito (anche con Google) e si torna qui per accettare; con un
 * altro conto si chiede di cambiarlo. Scaduto, revocato o già accettato: lo si dice.
 */
export default async function CarePortalInvitePage({
  params,
}: PageProps<'/cuenta/floral-care/invitacion/[token]'>) {
  const { token } = await params;
  const [preview, session, t] = await Promise.all([
    getCarePortalInvitePreview(carePortalSecret(), token),
    getSession(),
    getTranslations(),
  ]);
  const invitePath = accountRoutes.care.invite(token);

  if (!preview || preview.status !== 'PENDING') {
    const status = preview?.status ?? 'INVALID';
    const reason =
      status === 'EXPIRED'
        ? t('account.care.invite.expired')
        : status === 'REVOKED'
          ? t('account.care.invite.revoked')
          : status === 'ACCEPTED'
            ? t('account.care.invite.accepted')
            : t('account.care.invite.invalid');
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>{t('account.care.invite.invalidTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert variant={status === 'ACCEPTED' ? 'info' : 'destructive'}>
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href={status === 'ACCEPTED' ? accountRoutes.care.home : '/'}>
              {status === 'ACCEPTED' ? t('account.care.invite.goToCare') : t('errors.goHome')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const intro = (
    <div className="mb-6 flex items-start gap-3 rounded-xl bg-muted/60 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Leaf className="size-5" aria-hidden="true" />
      </span>
      <div className="text-sm leading-relaxed">
        <p>{t('account.care.invite.body')}</p>
        <p className="mt-1 text-muted-foreground">
          {t('account.care.invite.forEmail', { email: preview.email })}
        </p>
      </div>
    </div>
  );

  let content: React.ReactNode;
  if (!session) {
    content = (
      <div className="space-y-3">
        <p className="text-sm">
          {t('account.care.invite.loginToAccept', { email: preview.email })}
        </p>
        {isGoogleLoginEnabled() ? (
          <>
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
            {t('account.care.invite.signup')}
          </Link>
        </Button>
      </div>
    );
  } else if (normalizeEmail(session.user.email) !== preview.email) {
    content = (
      <div className="space-y-4">
        <Alert variant="warning">
          <AlertDescription>
            {t('account.care.invite.wrongAccount', {
              current: session.user.email,
              email: preview.email,
            })}
          </AlertDescription>
        </Alert>
        <SignOutButton
          label={t('account.care.invite.switchAccount')}
          redirectTo={`/login?next=${encodeURIComponent(invitePath)}`}
        />
      </div>
    );
  } else {
    content = <AcceptPortalInviteForm action={acceptCarePortalInviteAction.bind(null, token)} />;
  }

  return (
    <Card className="mx-auto max-w-md" data-testid="care-portal-invite">
      <CardHeader>
        <CardTitle>{t('account.care.invite.title', { shop: preview.shopName })}</CardTitle>
      </CardHeader>
      <CardContent>
        {intro}
        {content}
      </CardContent>
    </Card>
  );
}
