'use client';

import { TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { normalizeTotpCode } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/input';
import { authPath } from '@/lib/auth-paths';
import { authClient, authErrorKey } from '@/lib/auth-client';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Il codice di 6 cifre dell'app, oppure (se il telefono non c'è) uno dei codici di respaldo, che
 * vale una volta sola. "Confiar en este dispositivo" evita il codice per 30 giorni su questo browser.
 */
export function TwoFactorChallengeForm({ next, trustDays }: { next: string; trustDays: number }) {
  const t = useTranslations('security.challenge');
  const ta = useTranslations('auth');
  const router = useRouter();
  const hydrated = useHydrated();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const raw = String(data.get('code') ?? '').trim();
    const trustDevice = data.get('trustDevice') === 'on';
    setError(null);
    if (mode === 'totp' && !normalizeTotpCode(raw)) {
      setError(t('codeFormat'));
      return;
    }
    if (mode === 'backup' && raw === '') {
      setError(t('backupRequired'));
      return;
    }
    startTransition(async () => {
      const result =
        mode === 'totp'
          ? await authClient.twoFactor.verifyTotp({ code: normalizeTotpCode(raw)!, trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code: raw, trustDevice });
      if (result.error) {
        const key = authErrorKey(result.error);
        if (key === 'INVALID_TWO_FACTOR_COOKIE') setExpired(true);
        else setError(ta(`errors.${key}`));
        return;
      }
      router.replace(next);
      router.refresh();
    });
  }

  if (expired) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('expired')}</AlertDescription>
        </Alert>
        <Button asChild className="w-full" size="lg">
          <Link href={authPath('/login', { next })}>{t('backToLogin')}</Link>
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
      {mode === 'totp' ? (
        <Field id="code" label={t('codeLabel')} hint={t('codeHint')}>
          <Input
            {...controlProps('code', undefined, true)}
            key="totp"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 \-]*"
            maxLength={9}
            autoFocus
            required
          />
        </Field>
      ) : (
        <Field id="code" label={t('backupLabel')} hint={t('backupHint')}>
          <Input
            {...controlProps('code', undefined, true)}
            key="backup"
            name="code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={40}
            autoFocus
            required
          />
        </Field>
      )}
      <label className="flex items-start gap-3 text-sm">
        <Checkbox name="trustDevice" className="mt-0.5" />
        <span>{t('trustDevice', { days: trustDays })}</span>
      </label>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={!hydrated || pending}
        aria-busy={pending}
      >
        {t('submit')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => {
          setError(null);
          setMode(mode === 'totp' ? 'backup' : 'totp');
        }}
      >
        {mode === 'totp' ? t('useBackup') : t('useApp')}
      </Button>
    </form>
  );
}
