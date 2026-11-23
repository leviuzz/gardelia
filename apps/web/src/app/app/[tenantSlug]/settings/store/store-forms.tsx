'use client';

import { Copy, ExternalLink, ImageIcon, MessageCircle, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { toast } from 'sonner';
import {
  MARKETPLACE_ORDER_LIMITS,
  PHOTO_LIMITS,
  STORE_LIMITS,
  STORE_PAYMENT_METHODS,
  type StoreImageKind,
  type StorePaymentMethod,
} from '@floral/domain';
import { ActionButton } from '@/components/form/action-button';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

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

/**
 * "Pedidos en línea" (ADR-067): se chi compra può ordinare dalla pagina e con quanto anticipo.
 * Accenderli richiede un modo di pagare e il telefono (il servizio lo ricontrolla).
 */
export function OnlineOrdersForm({
  action,
  defaults,
  canEnable,
}: {
  readonly action: Action;
  readonly defaults: { readonly ordersEnabled: boolean; readonly minLeadDays: number };
  /** Falso se manca qualcosa per accenderli (l'elenco lo mostra la pagina). */
  readonly canEnable: boolean;
}) {
  const t = useTranslations('store.orders');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-5">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
        <Checkbox
          name="ordersEnabled"
          defaultChecked={defaults.ordersEnabled}
          disabled={!canEnable && !defaults.ordersEnabled}
          className="mt-0.5"
        />
        <span className="grid gap-1">
          <span className="text-sm font-medium">{t('enabled')}</span>
          <span className="text-sm text-muted-foreground">{t('enabledHint')}</span>
        </span>
      </label>
      <Field
        id="store-lead-days"
        label={t('leadDays')}
        hint={t('leadDaysHint')}
        error={err('minLeadDays')}
        className="sm:max-w-xs"
      >
        <NativeSelect
          {...controlProps('store-lead-days', err('minLeadDays'), true)}
          name="minLeadDays"
          defaultValue={String(defaults.minLeadDays)}
        >
          {Array.from({ length: MARKETPLACE_ORDER_LIMITS.leadDaysMax + 1 }, (_, days) => (
            <option key={days} value={days}>
              {t('leadDaysOption', { count: days })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {/* Nome proprio: nella pagina c'è anche il "Guardar" della presentazione. */}
      <SubmitButton className="w-fit">{t('save')}</SubmitButton>
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

/**
 * Logo (quadrato, piccolo accanto al nome) o foto di copertina (larga, in alto nella pagina):
 * anteprima, caricamento di una foto (ridotta nel browser come quelle del catalogo) e "Quitar".
 */
export function StoreImageField({
  kind,
  imageSrc,
  upload,
  removeAction,
}: {
  readonly kind: StoreImageKind;
  /** Anteprima dell'immagine attuale, o null. */
  readonly imageSrc: string | null;
  readonly upload: (formData: FormData) => Promise<ActionState>;
  readonly removeAction: Action;
}) {
  const t = useTranslations('store');
  const state = usePhotoUpload(upload, { maxFiles: 1, maxSide: PHOTO_LIMITS.clientMaxSide });
  const isLogo = kind === 'LOGO';
  const preview = isLogo ? 'size-24 rounded-2xl' : 'aspect-[3/1] w-full rounded-xl';
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-medium">{isLogo ? t('logo') : t('cover')}</p>
        <p className="text-xs text-muted-foreground">{isLogo ? t('logoHint') : t('coverHint')}</p>
      </div>
      <div
        className={cn('flex items-center justify-center overflow-hidden border bg-muted', preview)}
      >
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- immagine privata servita dall'app.
          <img
            src={imageSrc}
            alt={isLogo ? t('logo') : t('cover')}
            className={isLogo ? 'size-full bg-white object-contain' : 'size-full object-cover'}
          />
        ) : (
          <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <form method="post" onSubmit={state.onSubmit} className="space-y-3">
        <PhotoFilesField
          id={`store-image-${kind.toLowerCase()}`}
          label={isLogo ? t('logoFile') : t('coverFile')}
          hint={t('imageFileHint')}
          error={state.fieldErrors['files'] ?? state.fieldErrors['file']}
          multiple={false}
        />
        <PhotoUploadFooter
          state={state}
          submitLabel={
            imageSrc
              ? isLogo
                ? t('changeLogo')
                : t('changeCover')
              : isLogo
                ? t('uploadLogo')
                : t('uploadCover')
          }
        />
      </form>
      {imageSrc ? (
        <ActionButton action={removeAction} variant="ghost" icon={<Trash />} className="w-fit">
          {isLogo ? t('removeLogo') : t('removeCover')}
        </ActionButton>
      ) : null}
    </div>
  );
}
