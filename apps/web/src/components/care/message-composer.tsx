'use client';

import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CARE_MESSAGE_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import { prepareImageForUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

/**
 * Il modulo di un messaggio (ADR-084), per la fioreria e per il portale: testo e al massimo una
 * foto, ridotta nel browser prima dell'invio (il server la ricodifica comunque). La chiave
 * dell'invio resta la stessa finché non va a buon fine: un doppio clic o un nuovo tentativo dopo
 * un errore di rete non scrivono due messaggi.
 */
export function MessageComposer({
  id,
  action,
  maxSide,
}: {
  readonly id: string;
  readonly action: (formData: FormData) => Promise<ActionState>;
  readonly maxSide: number;
}) {
  const t = useTranslations('care.messages.composer');
  const tValidation = useTranslations('validation');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [submitKey, setSubmitKey] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearFile() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (body.trim() === '' && !file) {
      setError(t('empty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = new FormData();
      data.set('body', body);
      data.set('submitKey', submitKey);
      if (file) {
        const prepared = await prepareImageForUpload(file, maxSide);
        if (prepared.size > PHOTO_LIMITS.maxUploadBytes) {
          setError(tValidation('file_too_large'));
          return;
        }
        data.set('file', prepared);
      }
      const result = await action(data);
      if (result.status === 'success') {
        setBody('');
        clearFile();
        setSubmitKey(crypto.randomUUID());
        if (result.message) toast.success(result.message);
        router.refresh();
      } else if (result.status === 'error') {
        const fields = result.fieldErrors ?? {};
        setError(fields.body ?? fields.file ?? result.message);
      }
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  const errorId = `${id}-error`;
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-2" data-testid="message-composer">
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <Textarea
        id={id}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t('placeholder')}
        maxLength={CARE_MESSAGE_LIMITS.body}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {file ? (
        <p className="flex items-center gap-2 text-sm">
          <span className="min-w-0 truncate">{t('photoChosen', { name: file.name })}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={clearFile}
            disabled={busy}
            aria-label={t('removeChosen')}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="message-photo-input"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {t('addPhoto')}
          </Button>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">{t('hint')}</p>
        <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          {t('send')}
        </Button>
      </div>
    </form>
  );
}
