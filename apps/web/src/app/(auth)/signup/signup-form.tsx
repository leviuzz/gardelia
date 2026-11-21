'use client';

import { TriangleExclamationPoint } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, authErrorKey } from '@/lib/auth-client';

const MIN_PASSWORD = 10;

export function SignupForm({ next, defaultEmail }: { next: string; defaultEmail: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirm') ?? '');
    setError(null);
    setConfirmError(null);
    if (password !== confirm) {
      setConfirmError(t('passwordsDontMatch'));
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(t('errors.PASSWORD_TOO_SHORT'));
      return;
    }
    startTransition(async () => {
      // Dopo la conferma dell'email l'utente torna su /verify-email, poi alla destinazione.
      const callbackURL = `/verify-email?next=${encodeURIComponent(next)}`;
      const result = await authClient.signUp.email({ name, email, password, callbackURL });
      if (result.error) {
        setError(t(`errors.${authErrorKey(result.error)}`));
        return;
      }
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Field id="name" label={t('name')}>
        <Input {...controlProps('name')} name="name" autoComplete="name" required maxLength={120} />
      </Field>
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
      <Field id="password" label={t('password')} hint={t('passwordHint')}>
        <PasswordInput
          {...controlProps('password', undefined, true)}
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          maxLength={128}
          required
        />
      </Field>
      <Field id="confirm" label={t('confirmPassword')} error={confirmError ?? undefined}>
        <PasswordInput
          {...controlProps('confirm', confirmError ?? undefined)}
          name="confirm"
          autoComplete="new-password"
          required
        />
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('termsNote')}</p>
      <Button type="submit" className="w-full" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? t('signingUp') : t('signupButton')}
      </Button>
    </form>
  );
}
