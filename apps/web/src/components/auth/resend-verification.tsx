'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { useHydrated } from '@/lib/use-hydrated';

/** Reinvio del link di verifica. La risposta è sempre la stessa (nessuna enumerazione di account). */
export function ResendVerification({ defaultEmail, next }: { defaultEmail: string; next: string }) {
  const t = useTranslations('auth');
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    startTransition(async () => {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: `/verify-email?next=${encodeURIComponent(next)}`,
      });
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Alert variant="success">
        <AlertDescription>{t('verificationResent')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <Field id="resend-email" label={t('email')}>
        <Input
          {...controlProps('resend-email')}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          required
        />
      </Field>
      <Button type="submit" variant="outline" className="w-full" disabled={!hydrated || pending}>
        {t('resendVerification')}
      </Button>
    </form>
  );
}
