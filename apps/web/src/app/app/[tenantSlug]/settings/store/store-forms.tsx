'use client';

import { Copy, ExternalLink, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { toast } from 'sonner';
import { STORE_LIMITS, STORE_PAYMENT_METHODS, type StorePaymentMethod } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Cosa vede il cliente oltre ai prodotti: presentazione e come pagare (pagamento diretto). */
export function StoreInfoForm({
  action,
  defaults,
}: {
  readonly action: Action;
  readonly defaults: {
    readonly description: string;
    readonly paymentMethods: readonly StorePaymentMethod[];
    readonly paymentInstructions: string;
  };
}) {
  const t = useTranslations('store');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-5">
      <Field
        id="store-description"
        label={t('description')}
        hint={t('descriptionHint')}
        error={err('description')}
      >
        <Textarea
          {...controlProps('store-description', err('description'), true)}
          name="description"
          defaultValue={defaults.description}
          maxLength={STORE_LIMITS.description}
          rows={3}
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('paymentMethods')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {STORE_PAYMENT_METHODS.map((method) => (
            <label
              key={method}
              className="flex cursor-pointer items-center gap-3 rounded-xl border p-3"
            >
              <Checkbox
                name="paymentMethods"
                value={method}
                defaultChecked={defaults.paymentMethods.includes(method)}
              />
              <span className="text-sm">{t(`payment.${method}`)}</span>
            </label>
          ))}
        </div>
        {err('paymentMethods') ? (
          <p className="text-sm text-destructive">{err('paymentMethods')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('paymentMethodsHint')}</p>
        )}
      </fieldset>
      <Field
        id="store-payment-instructions"
        label={t('paymentInstructions')}
        hint={t('paymentInstructionsHint')}
        error={err('paymentInstructions')}
      >
        <Textarea
          {...controlProps('store-payment-instructions', err('paymentInstructions'), true)}
          name="paymentInstructions"
          defaultValue={defaults.paymentInstructions}
          maxLength={STORE_LIMITS.paymentInstructions}
          rows={2}
        />
      </Field>
      <SubmitButton className="w-fit">{tc('save')}</SubmitButton>
    </form>
  );
}

/** Indirizzo della tienda pubblicata: copiarlo, aprirlo, mandarlo su WhatsApp. */
export function StoreLinkCard({
  url,
  whatsappHref,
}: {
  readonly url: string;
  readonly whatsappHref: string;
}) {
  const t = useTranslations('store');

  async function copy() {
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
          value={url}
          aria-label={t('linkLabel')}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy />
          {t('copy')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t('open')}
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
            {t('shareWhatsapp')}
          </a>
        </Button>
      </div>
    </div>
  );
}
