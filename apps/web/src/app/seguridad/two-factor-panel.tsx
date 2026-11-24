'use client';

import { Copy, Download, KeyRound, ShieldCheck, TriangleExclamationPoint } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { normalizeTotpCode } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password-input';
import { QrCode } from '@/components/security/qr-code';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/input';
import { authClient, authErrorKey } from '@/lib/auth-client';
import { useHydrated } from '@/lib/use-hydrated';

type Phase =
  | { readonly step: 'idle' }
  | { readonly step: 'password'; readonly purpose: 'enable' | 'codes' | 'disable' }
  | {
      readonly step: 'scan';
      readonly uri: string;
      readonly secret: string;
      readonly backupCodes: readonly string[];
    }
  | { readonly step: 'codes'; readonly backupCodes: readonly string[]; readonly fresh: boolean };

/** La chiave da scrivere a mano nell'app, a gruppi di 4 ("ABCD EFGH …"). */
function secretOf(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    return secret.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}

/**
 * Verifica in due passaggi (ADR-077). Da spenta: password → QR e primo codice → codici di
 * respaldo da salvare. Da accesa: nuovi codici di respaldo o disattivarla, sempre con la password.
 * Tutte le chiamate passano da /api/auth (limite ai tentativi di Better Auth).
 */
export function TwoFactorPanel({
  enabled,
  required,
  deadline,
}: {
  enabled: boolean;
  /** Obbligatoria per questa persona (titolare): disattivarla blocca le sue fiorerie. */
  required: boolean;
  /** Data entro cui attivarla, già scritta ("8 de diciembre de 2026"), o null. */
  deadline: string | null;
}) {
  const t = useTranslations('security.twoFactor');
  const ta = useTranslations('auth');
  const router = useRouter();
  const hydrated = useHydrated();
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function fail(result: { code?: string | undefined; status?: number } | null) {
    setError(ta(`errors.${authErrorKey(result)}`));
  }

  function onPassword(event: FormEvent<HTMLFormElement>, purpose: 'enable' | 'codes' | 'disable') {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setError(null);
    startTransition(async () => {
      if (purpose === 'enable') {
        const result = await authClient.twoFactor.enable({ password });
        if (result.error || !result.data) return fail(result.error);
        const uri = 'totpURI' in result.data ? (result.data.totpURI ?? '') : '';
        const backupCodes = 'backupCodes' in result.data ? (result.data.backupCodes ?? []) : [];
        setPhase({ step: 'scan', uri, secret: secretOf(uri), backupCodes });
      } else if (purpose === 'codes') {
        const result = await authClient.twoFactor.generateBackupCodes({ password });
        if (result.error || !result.data) return fail(result.error);
        setPhase({ step: 'codes', backupCodes: result.data.backupCodes, fresh: false });
      } else {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) return fail(result.error);
        setPhase({ step: 'idle' });
        toast.success(t('disabled'));
        router.refresh();
      }
    });
  }

  function onVerify(event: FormEvent<HTMLFormElement>, backupCodes: readonly string[]) {
    event.preventDefault();
    const code = normalizeTotpCode(String(new FormData(event.currentTarget).get('code') ?? ''));
    setError(null);
    if (!code) {
      setError(t('codeFormat'));
      return;
    }
    startTransition(async () => {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) return fail(result.error);
      setPhase({ step: 'codes', backupCodes, fresh: true });
    });
  }

  function finish() {
    setPhase({ step: 'idle' });
    router.refresh();
  }

  const errorAlert = error ? (
    <Alert variant="destructive">
      <TriangleExclamationPoint aria-hidden="true" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (phase.step === 'password') {
    const purpose = phase.purpose;
    return (
      <form method="post" onSubmit={(event) => onPassword(event, purpose)} className="grid gap-4">
        {errorAlert}
        {purpose === 'disable' && required ? (
          <Alert variant="warning">
            <TriangleExclamationPoint aria-hidden="true" />
            <AlertDescription>{t('disableRequiredWarning')}</AlertDescription>
          </Alert>
        ) : null}
        <Field id="tf-password" label={t('passwordLabel')} hint={t(`passwordHint.${purpose}`)}>
          <PasswordInput
            {...controlProps('tf-password', undefined, true)}
            name="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={purpose === 'disable' ? 'destructive' : 'default'}
            disabled={!hydrated || pending}
            aria-busy={pending}
          >
            {t(`passwordSubmit.${purpose}`)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError(null);
              setPhase({ step: 'idle' });
            }}
          >
            {t('cancel')}
          </Button>
        </div>
      </form>
    );
  }

  if (phase.step === 'scan') {
    const { uri, secret, backupCodes } = phase;
    return (
      <div className="grid gap-5">
        <ol className="grid gap-1 text-sm text-muted-foreground">
          <li>{t('scan.step1')}</li>
          <li>{t('scan.step2')}</li>
        </ol>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <QrCode value={uri} label={t('scan.qrLabel')} />
          <div className="grid w-full gap-1 text-sm">
            <p className="text-muted-foreground">{t('scan.manual')}</p>
            <code
              className="rounded-lg bg-muted px-3 py-2 font-mono text-sm break-words"
              data-testid="totp-secret"
            >
              {secret}
            </code>
          </div>
        </div>
        <form
          method="post"
          onSubmit={(event) => onVerify(event, backupCodes)}
          className="grid gap-4"
        >
          {errorAlert}
          <Field id="tf-code" label={t('scan.codeLabel')} hint={t('scan.codeHint')}>
            <Input
              {...controlProps('tf-code', undefined, true)}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              required
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
              <ShieldCheck />
              {t('scan.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setPhase({ step: 'idle' });
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (phase.step === 'codes') {
    return <BackupCodes codes={phase.backupCodes} fresh={phase.fresh} onDone={finish} />;
  }

  // Riposo: stato attuale e cosa si può fare.
  return (
    <div className="grid gap-4">
      {enabled ? (
        <>
          <p className="flex items-center gap-2 text-sm">
            <Badge variant="success">{t('statusOn')}</Badge>
            {t('onBody')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPhase({ step: 'password', purpose: 'codes' })}
            >
              <KeyRound />
              {t('newCodes')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPhase({ step: 'password', purpose: 'disable' })}
            >
              {t('disable')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{t('statusOff')}</Badge>
            {t('offBody')}
          </p>
          {required && deadline ? (
            <Alert variant="warning">
              <TriangleExclamationPoint aria-hidden="true" />
              <AlertDescription>{t('requiredBy', { date: deadline })}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button type="button" onClick={() => setPhase({ step: 'password', purpose: 'enable' })}>
              <ShieldCheck />
              {t('enable')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** I codici di respaldo: si copiano o si scaricano, e si conferma di averli salvati. */
function BackupCodes({
  codes,
  fresh,
  onDone,
}: {
  codes: readonly string[];
  /** Appena attivata (titolo "Listo") invece di codici rigenerati. */
  fresh: boolean;
  onDone: () => void;
}) {
  const t = useTranslations('security.twoFactor.codes');
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([`${t('fileTitle')}\n\n${text}\n`], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = t('fileName');
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4" data-testid="backup-codes">
      <Alert variant={fresh ? 'success' : 'info'}>
        <ShieldCheck aria-hidden="true" />
        <AlertDescription>{fresh ? t('enabled') : t('regenerated')}</AlertDescription>
      </Alert>
      <p className="text-sm">{t('body')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          <Copy />
          {t('copy')}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download />
          {t('download')}
        </Button>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <span>{t('savedCheck')}</span>
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}
