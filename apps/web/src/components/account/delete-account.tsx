'use client';

import { LoaderCircle, MailCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { authClient } from '@/lib/auth-client';
import { accountRoutes } from '@/lib/routes';

/** Messaggio di un errore di Better Auth (troppe richieste, cancellazione non permessa…). */
function errorKey(error: { code?: string | undefined; status?: number } | null): string {
  if (error?.status === 429) return 'tooMany';
  if (error?.code === 'ACCOUNT_DELETION_BLOCKED') return 'blocked';
  if (error?.code === 'INVALID_TOKEN') return 'invalidLink';
  return 'generic';
}

/**
 * "Eliminar mi cuenta" (ADR-068): spiega cosa si cancella e cosa resta, poi chiede la conferma per
 * email. Niente si cancella con questo pulsante: serve il clic nel link.
 */
export function DeleteAccountButton() {
  const t = useTranslations('account.privacy');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.deleteUser({ callbackURL: accountRoutes.deleted });
    setBusy(false);
    if (failure) {
      setError(t(`errors.${errorKey(failure)}`));
      return;
    }
    setOpen(false);
    setSent(true);
  }

  if (sent) {
    return (
      <Alert variant="info">
        <MailCheck aria-hidden="true" />
        <AlertDescription>{t('emailSent')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 />
          {t('delete')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteIntro')}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>{t('deleteWhat')}</li>
          <li>{t('deleteOrders')}</li>
          <li>{t('deleteEmail')}</li>
        </ul>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tc('cancel')}
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={request} disabled={busy} aria-busy={busy}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {t('deleteSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ultimo passo, dal link dell'email: la cancellazione vera e propria. */
export function ConfirmDeleteAccount({ token }: { readonly token: string }) {
  const t = useTranslations('account.privacy');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.deleteUser({ token });
    if (failure) {
      setBusy(false);
      setError(t(`errors.${errorKey(failure)}`));
      return;
    }
    // La sessione non esiste più: si va alla pagina pubblica di commiato.
    router.replace(accountRoutes.deleted);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="destructive" onClick={confirm} disabled={busy} aria-busy={busy}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 />}
        {t('confirmDelete')}
      </Button>
    </div>
  );
}
