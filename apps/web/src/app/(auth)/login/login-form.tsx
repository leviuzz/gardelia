'use client';

import { CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, authErrorKey } from '@/lib/auth-client';
import { securityRoutes } from '@/lib/routes';
import { useHydrated } from '@/lib/use-hydrated';

export function LoginForm({ next, defaultEmail }: { next: string; defaultEmail: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    setError(null);
    setNotice(null);
    startTransition(async () => {
      // Il callbackURL serve anche all'email di verifica che Better Auth reinvia se l'account
      // non è ancora confermato: dopo la conferma l'utente torna alla destinazione originale.
      const callbackURL = `/verify-email?next=${encodeURIComponent(next)}`;
      const result = await authClient.signIn.email({ email, password, callbackURL });
      if (result.error) {
        const key = authErrorKey(result.error);
        if (key === 'EMAIL_NOT_VERIFIED') setNotice(t('errors.EMAIL_NOT_VERIFIED'));
        else setError(t(`errors.${key}`));
        return;
      }
      // Verifica in due passaggi (ADR-077): la password va bene, manca il codice.
      if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
        router.push(securityRoutes.verify(next));
        return;
      }
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      {error ? (
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="info">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      <Field id="email" label={t('email')}>
        <Input
          {...controlProps('email')}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={defaultEmail}
          required
        />
      </Field>
      <Field id="password" label={t('password')}>
        <PasswordInput
          {...controlProps('password')}
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          {t('forgotPassword')}
        </Link>
      </div>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={!hydrated || pending}
        aria-busy={pending}
      >
        {pending ? t('loggingIn') : t('loginButton')}
      </Button>
    </form>
  );
}
