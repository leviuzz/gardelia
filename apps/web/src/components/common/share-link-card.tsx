'use client';

import { Copy, Link2, MessageCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface ShareLinkView {
  readonly url: string;
  /** "Vence el 22 de enero de 2027." */
  readonly expiresLabel: string;
  /** Messaggio al cliente con il link, nella lingua del mercato; null senza telefono. */
  readonly whatsappHref: string | null;
}

/**
 * Link pubblico di un preventivo o di un ordine (ADR-056): crearlo, copiarlo, mandarlo su
 * WhatsApp, rinnovarlo o disattivarlo. Il servizio ricontrolla permessi e stato del documento.
 */
export function ShareLinkPanel({
  link,
  shareAction,
  revokeAction,
  unavailableHint,
}: {
  readonly link: ShareLinkView | null;
  /** Crea (o, con `renew=1`, rinnova) il link. */
  readonly shareAction: Action;
  readonly revokeAction: Action;
  /** Perché non si può ancora condividere (es. preventivo in bozza); null se si può. */
  readonly unavailableHint: string | null;
}) {
  const t = useTranslations('shareLink');

  if (!link) {
    return unavailableHint ? (
      <p className="text-sm text-muted-foreground">{unavailableHint}</p>
    ) : (
      <ActionButton action={shareAction} variant="secondary" icon={<Link2 />}>
        {t('create')}
      </ActionButton>
    );
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Input
          readOnly
          value={link.url}
          aria-label={t('linkLabel')}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={() => void copy(link.url)}>
          <Copy />
          {t('copy')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{link.expiresLabel}</p>
      <div className="flex flex-wrap gap-2">
        {link.whatsappHref ? (
          <Button asChild variant="secondary">
            <a href={link.whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {t('whatsapp')}
            </a>
          </Button>
        ) : null}
        <ConfirmActionDialog
          action={shareAction}
          fields={{ renew: '1' }}
          confirmVariant="default"
          trigger={
            <Button variant="ghost">
              <RefreshCw />
              {t('renew')}
            </Button>
          }
          title={t('renewTitle')}
          description={t('renewBody')}
          confirmLabel={t('renewConfirm')}
        />
        <ConfirmActionDialog
          action={revokeAction}
          trigger={
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              {t('revoke')}
            </Button>
          }
          title={t('revokeTitle')}
          description={t('revokeBody')}
          confirmLabel={t('revokeConfirm')}
        />
      </div>
    </div>
  );
}
