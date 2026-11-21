'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type SVGProps } from 'react';
import { Button } from '@/components/ui/button';
import { authClient, authErrorKey } from '@/lib/auth-client';

/**
 * "Continuar con Google" (ADR-036). Better Auth porta il browser su Google; al ritorno l'utente
 * arriva su `callbackURL` (già autenticato) oppure su `errorCallbackURL` con `?error=<codice>`.
 * Si mostra solo se il login con Google è configurato sul server.
 */
export function GoogleSignInButton({
  callbackURL,
  errorCallbackURL,
  loginHint,
}: {
  readonly callbackURL: string;
  readonly errorCallbackURL: string;
  /** Email suggerita a Google (es. quella dell'invito), se nota. */
  readonly loginHint?: string | undefined;
}) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tornando indietro da Google il browser può ripristinare la pagina dalla cache: il pulsante
  // non deve restare bloccato su "Abriendo Google…".
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL,
      errorCallbackURL,
      ...(loginHint ? { loginHint } : {}),
    });
    // Se tutto va bene il browser sta già andando su Google: il pulsante resta in attesa.
    if (result.error) {
      setPending(false);
      setError(t(`errors.${authErrorKey(result.error)}`));
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        <GoogleLogo className="size-[18px]" />
        {pending ? t('google.redirecting') : t('google.continue')}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">{t('google.consent')}</p>
    </div>
  );
}

/** Separatore fra Google e il modulo con email e password. */
export function AuthDivider({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="presentation">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Logo "G" di Google con i colori ufficiali (linee guida del marchio: non va modificato). */
function GoogleLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
