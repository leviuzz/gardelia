'use client';

import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ORDER_MONEY_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import { prepareImageForUpload } from '@/components/photos/use-photo-upload';
import { Field, controlProps } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

/**
 * «Ya pagué: sube tu comprobante» (M3-3, ADR-088): la foto (obbligatoria, ridotta nel browser prima
 * dell'invio; il server la ricodifica senza EXIF), l'importo (proposto: quanto manca) e una nota. La
 * chiave dell'invio resta la stessa finché non va a buon fine: un doppio clic o un nuovo tentativo
 * dopo un errore di rete non scrivono due prove.
 */
export function BuyerPaymentProofForm({
  action,
  currency,
  defaultAmount,
}: {
  readonly action: (formData: FormData) => Promise<ActionState>;
  readonly currency: string;
  /** Proposta: quanto manca da pagare. */
  readonly defaultAmount: string;
}) {
  const t = useTranslations('account.orderPage.payments');
  const tValidation = useTranslations('validation');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [submitKey, setSubmitKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);

  function clearFile() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setErrors({ photo: tValidation('file_required') });
      setMessage(null);
      return;
    }
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const prepared = await prepareImageForUpload(file, PHOTO_LIMITS.clientMaxSide);
      if (prepared.size > PHOTO_LIMITS.maxUploadBytes) {
        setErrors({ photo: tValidation('file_too_large') });
        return;
      }
      const data = new FormData();
      data.set('amount', amount);
      data.set('note', note);
      data.set('submitKey', submitKey);
      data.set('file', prepared);
      const result = await action(data);
      if (result.status === 'success') {
        setNote('');
        clearFile();
        setSubmitKey(crypto.randomUUID());
        if (result.message) toast.success(result.message);
        router.refresh();
      } else if (result.status === 'error') {
        const fields = result.fieldErrors ?? {};
        // La foto: `photo` dal servizio, `file` dal controllo del caricamento.
        const photo = fields.photo ?? fields.file;
        setErrors({
          ...(fields.amount ? { amount: fields.amount } : {}),
          ...(fields.note ? { note: fields.note } : {}),
          ...(photo ? { photo } : {}),
        });
        setMessage(fields.amount || fields.note || photo ? null : (result.message ?? null));
      }
    } catch {
      setMessage(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="grid gap-4"
      data-testid="payment-proof-form"
      noValidate
    >
      <Field
        id="proof-amount"
        label={t('amount', { currency })}
        hint={t('amountHint')}
        error={errors.amount}
        required
      >
        <Input
          {...controlProps('proof-amount', errors.amount, true)}
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </Field>
      <Field id="proof-note" label={t('note')} error={errors.note}>
        <Textarea
          {...controlProps('proof-note', errors.note)}
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('notePlaceholder')}
          maxLength={ORDER_MONEY_LIMITS.proofNote}
          rows={2}
        />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="proof-photo-label">
          {t('photo')}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="payment-proof-photo"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setErrors((current) => {
              const next: Record<string, string> = { ...current };
              delete next.photo;
              return next;
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            aria-describedby={errors.photo ? 'proof-photo-error' : 'proof-photo-label'}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {file ? t('changePhoto') : t('choosePhoto')}
          </Button>
          {file ? (
            <span className="flex min-w-0 items-center gap-1 text-sm">
              <span className="min-w-0 truncate">{t('photoChosen', { name: file.name })}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={clearFile}
                disabled={busy}
                aria-label={t('removePhoto')}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </span>
          ) : null}
        </div>
        {errors.photo ? (
          <p id="proof-photo-error" role="alert" className="text-sm text-destructive">
            {errors.photo}
          </p>
        ) : null}
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy} data-testid="payment-proof-submit">
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
