import { Info, TriangleExclamationPoint } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { OAuthErrorKey } from '@/lib/oauth-errors';

/** Messaggio mostrato al ritorno da Google quando l'accesso non è andato a buon fine. */
export async function OAuthErrorAlert({ error }: { readonly error: OAuthErrorKey }) {
  const t = await getTranslations('auth.google.errors');
  // Annullare su Google non è un errore: avviso neutro.
  const cancelled = error === 'cancelled';
  return (
    <Alert variant={cancelled ? 'info' : 'destructive'}>
      {cancelled ? <Info aria-hidden="true" /> : <TriangleExclamationPoint aria-hidden="true" />}
      <AlertDescription>{t(error)}</AlertDescription>
    </Alert>
  );
}
