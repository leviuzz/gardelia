'use client';

/**
 * Floral Care, la pagina del cliente (ADR-084) — lato fioreria: il modulo "Invitar" e il link di
 * un invito da copiare o mandare per WhatsApp. Il server ricontrolla tutto: qui solo i campi.
 */
import { Copy, MessageCircle, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

/** "Invitar": email (quella del cliente, se c'è), questo contratto o tutti, i soldi sì o no. */
export function PortalInviteForm({
  action,
  defaultEmail,
}: {
  readonly action: Action;
  readonly defaultEmail: string | null;
}) {
  const t = useTranslations('care.portal');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4"
      data-testid="portal-invite-form"
    >
      <Field id="portal-email" label={t('email')} error={err('email')} required>
        <Input
          {...controlProps('portal-email', err('email'), true)}
          name="email"
          type="email"
          autoComplete="off"
          defaultValue={defaultEmail ?? ''}
          required
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('scope')}</legend>
        <label className={choice}>
          <input
            type="radio"
            name="scope"
            value="CONTRACT"
            defaultChecked
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{t('scopeContract')}</span>
        </label>
        <label className={choice}>
          <input
            type="radio"
            name="scope"
            value="CUSTOMER"
            className="mt-0.5 size-4 accent-primary"
          />
          <span>{t('scopeCustomer')}</span>
        </label>
      </fieldset>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm">
        <Checkbox name="canSeeMoney" value="on" defaultChecked className="mt-0.5" />
        <span>
          <span className="block font-medium">{t('money')}</span>
          <span className="block text-xs text-muted-foreground">{t('moneyHint')}</span>
        </span>
      </label>
      <div>
        <SubmitButton className="w-full sm:w-auto" pendingLabel={t('inviting')}>
          <UserPlus />
          {t('invite')}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Il link di un invito in attesa: copiarlo o mandarlo per WhatsApp. */
export function PortalInviteLink({
  url,
  whatsappHref,
}: {
  readonly url: string;
  readonly whatsappHref: string;
}) {
  const t = useTranslations('shareLink');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          readOnly
          value={url}
          aria-label={t('linkLabel')}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
          data-testid="portal-invite-url"
        />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy />
          {t('copy')}
        </Button>
      </div>
      <div>
        <Button asChild variant="secondary" size="sm">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
            {t('whatsapp')}
          </a>
        </Button>
      </div>
    </div>
  );
}
