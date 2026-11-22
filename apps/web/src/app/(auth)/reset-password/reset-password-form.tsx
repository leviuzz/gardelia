'use client';

import { CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authClient, authErrorKey } from '@/lib/auth-client';
import { useHydrated } from '@/lib/use-hydrated';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('password') ?? '');
    if (newPassword !== String(data.get('confirm') ?? '')) {
      setError(t('passwordsDontMatch'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        setError(t(`errors.${authErrorKey(result.error)}`));
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('resetDone')}</AlertDescription>
        </Alert>
        <Button asChild className="w-full" size="lg">
          <Link href="/login">{t('loginButton')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Field id="password" label={t('newPassword')} hint={t('passwordHint')}>
        <PasswordInput
          {...controlProps('password', undefined, true)}
          name="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
        />
      </Field>
      <Field id="confirm" label={t('confirmPassword')}>
        <PasswordInput
          {...controlProps('confirm')}
          name="confirm"
          autoComplete="new-password"
          required
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={!hydrated || pending}>
        {t('resetButton')}
      </Button>
    </form>
  );
}
