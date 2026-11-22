'use client';

import { CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { useHydrated } from '@/lib/use-hydrated';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [sent, setSent] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    startTransition(async () => {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      });
      // Stessa risposta che l'account esista o no: nessuna enumerazione degli utenti.
      if (result.error?.status === 429) {
        setRateLimited(true);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Alert variant="success">
        <CircleCheck aria-hidden="true" />
        <AlertDescription>{t('forgotSent')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {rateLimited ? (
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('errors.TOO_MANY_REQUESTS')}</AlertDescription>
        </Alert>
      ) : null}
      <Field id="email" label={t('email')}>
        <Input {...controlProps('email')} name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={!hydrated || pending}>
        {pending ? t('forgotSending') : t('forgotButton')}
      </Button>
    </form>
  );
}
