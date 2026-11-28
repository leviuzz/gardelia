'use client';

import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import {
  EVENT_TYPES,
  PHOTO_LIMITS,
  SERVICE_REQUEST_LIMITS,
  VENUE_RECURRENCES,
  VENUE_TYPES,
  WEEKLY_DURATIONS,
  type CareFrequency,
  type StorefrontServiceKind,
} from '@floral/domain';
import { AddressFields } from '@/components/form/address-fields';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { RadioCard } from '@/components/form/radio-card';
import { prepareImageForUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { idleState, type ActionState } from '@/lib/action-state';

const NEW_ADDRESS = 'new';
/** Le foto di una richiesta viaggiano insieme: più piccole di quelle del catalogo. */
const PHOTO_MAX_SIDE = 1600;

export interface ServiceRequestFormProps {
  readonly action: (formData: FormData) => Promise<ActionState>;
  readonly kind: StorefrontServiceKind;
  readonly askDate: boolean;
  readonly needsAddress: boolean;
  readonly currency: string;
  readonly minDate: string;
  readonly maxDate: string;
  readonly windows: readonly { readonly start: string; readonly end: string }[];
  readonly closedWeekdays: readonly number[];
  readonly careFrequencies: readonly CareFrequency[];
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly buyer: {
    readonly phone: string;
    readonly addresses: readonly { readonly id: string; readonly label: string }[];
  };
}

/**
 * Il modulo della richiesta di un servizio (M5, ADR-089), per tipo: evento, decorazione di un
 * locale, fiori ogni settimana, Floral Care o un servizio della fioreria. Fino a 3 foto di
 * ispirazione, ridotte nel browser (il server le ricodifica senza EXIF). La chiave dell'invio resta
 * la stessa finché non va a buon fine: un doppio clic non manda due richieste. Testi nella lingua
 * della fioreria, come la sua pagina.
 */
export function ServiceRequestForm(props: ServiceRequestFormProps) {
  const t = useTranslations('serviceRequest');
  const tValidation = useTranslations('validation');
  const fileInput = useRef<HTMLInputElement>(null);
  const [submitKey] = useState(() => crypto.randomUUID());
  const [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState>(idleState);
  const [addressChoice, setAddressChoice] = useState(props.buyer.addresses[0]?.id ?? NEW_ADDRESS);
  const newAddress = addressChoice === NEW_ADDRESS;
  const err = (field: string) =>
    state.status === 'error' ? state.fieldErrors?.[field] : undefined;
  const { kind } = props;
  const asksDate = kind === 'EVENT' || kind === 'VENUE' || kind === 'WEEKLY' || props.askDate;
  const dateRequired = kind === 'EVENT' || kind === 'VENUE' || kind === 'WEEKLY';
  const asksBudget = kind !== 'CARE';

  function pickFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((file) => file.size > 0);
    setFiles((current) => [...current, ...picked].slice(0, SERVICE_REQUEST_LIMITS.photos));
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      data.delete('photos');
      data.set('submitKey', submitKey);
      let total = 0;
      for (const file of files) {
        const prepared = await prepareImageForUpload(file, PHOTO_MAX_SIDE);
        total += prepared.size;
        data.append('photos', prepared);
      }
      // Tutte insieme: sotto il limite di una richiesta, o il server non le riceve.
      if (total > PHOTO_LIMITS.maxUploadBytes) {
        setState({
          status: 'error',
          message: tValidation('file_too_large'),
          fieldErrors: { photos: tValidation('file_too_large') },
        });
        return;
      }
      const result = await props.action(data);
      // Riuscita: il server porta alla pagina della richiesta (qui non torna niente).
      if (result) setState(result);
    } catch {
      setState({ status: 'error', message: t('networkError') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="grid gap-5"
      data-testid="service-request-form"
      noValidate
    >
      <FormAlert state={state} />

      {kind === 'EVENT' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="request-event-type" label={t('eventType')} error={err('eventType')} required>
            <NativeSelect
              {...controlProps('request-event-type', err('eventType'), true)}
              name="eventType"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`eventTypes.${type}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="request-guests" label={t('guests')} error={err('guests')} required>
            <Input
              {...controlProps('request-guests', err('guests'), true)}
              name="guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={SERVICE_REQUEST_LIMITS.guestsMax}
              required
            />
          </Field>
          <Field
            id="request-place"
            label={t('place')}
            hint={t('placeHint')}
            error={err('place')}
            required
            className="sm:col-span-2"
          >
            <Input
              {...controlProps('request-place', err('place'), true)}
              name="place"
              maxLength={SERVICE_REQUEST_LIMITS.place}
              required
            />
          </Field>
        </div>
      ) : null}

      {kind === 'VENUE' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="request-venue-type" label={t('venueType')} error={err('venueType')} required>
            <NativeSelect
              {...controlProps('request-venue-type', err('venueType'), true)}
              name="venueType"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {VENUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`venueTypes.${type}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="request-recurrence" label={t('recurrence')} error={err('recurrence')} required>
            <NativeSelect
              {...controlProps('request-recurrence', err('recurrence'), true)}
              name="recurrence"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {VENUE_RECURRENCES.map((recurrence) => (
                <option key={recurrence} value={recurrence}>
                  {t(`recurrences.${recurrence}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : null}

      {kind === 'WEEKLY' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="request-weekday" label={t('weekday')} error={err('weekday')} required>
            <NativeSelect
              {...controlProps('request-weekday', err('weekday'), true)}
              name="weekday"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {[1, 2, 3, 4, 5, 6, 0]
                .filter((day) => !props.closedWeekdays.includes(day))
                .map((day) => (
                  <option key={day} value={day}>
                    {t(`weekdays.${day}`)}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field id="request-window" label={t('window')} error={err('window')}>
            <NativeSelect
              {...controlProps('request-window', err('window'))}
              name="window"
              defaultValue=""
            >
              <option value="">{t('anyTime')}</option>
              {props.windows.map((window) => (
                <option
                  key={`${window.start}-${window.end}`}
                  value={`${window.start}-${window.end}`}
                >
                  {t('windowOption', { start: window.start, end: window.end })}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="request-duration" label={t('duration')} error={err('duration')} required>
            <NativeSelect
              {...controlProps('request-duration', err('duration'), true)}
              name="duration"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {WEEKLY_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {t(`durations.${duration}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : null}

      {kind === 'CARE' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="request-plants"
            label={t('plants')}
            hint={t('plantsHint')}
            error={err('plants')}
            required
          >
            <Input
              {...controlProps('request-plants', err('plants'), true)}
              name="plants"
              type="number"
              inputMode="numeric"
              min={1}
              max={SERVICE_REQUEST_LIMITS.plantsMax}
              required
            />
          </Field>
          <Field id="request-frequency" label={t('frequency')} error={err('frequency')} required>
            <NativeSelect
              {...controlProps('request-frequency', err('frequency'), true)}
              name="frequency"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t('choose')}
              </option>
              {props.careFrequencies.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {t(`frequencies.${frequency}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : null}

      {asksDate || asksBudget ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {asksDate ? (
            <Field
              id="request-date"
              label={kind === 'WEEKLY' || kind === 'VENUE' ? t('startDate') : t('date')}
              hint={dateRequired ? undefined : t('dateOptional')}
              error={err('date')}
              required={dateRequired}
            >
              <Input
                {...controlProps('request-date', err('date'), dateRequired)}
                name="date"
                type="date"
                min={props.minDate}
                max={props.maxDate}
                required={dateRequired}
              />
            </Field>
          ) : null}
          {asksBudget ? (
            <Field
              id="request-budget"
              label={
                kind === 'WEEKLY'
                  ? t('budgetWeekly', { currency: props.currency })
                  : t('budget', { currency: props.currency })
              }
              hint={t('budgetHint')}
              error={err('budget')}
            >
              <Input
                {...controlProps('request-budget', err('budget'))}
                name="budget"
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {props.needsAddress ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">{t('address')}</legend>
          {props.buyer.addresses.length > 0 ? (
            <div className="grid gap-2">
              {props.buyer.addresses.map((address) => (
                <RadioCard
                  key={address.id}
                  name="addressChoice"
                  value={address.id}
                  checked={addressChoice === address.id}
                  onChange={() => setAddressChoice(address.id)}
                >
                  {address.label}
                </RadioCard>
              ))}
              <RadioCard
                name="addressChoice"
                value={NEW_ADDRESS}
                checked={newAddress}
                onChange={() => setAddressChoice(NEW_ADDRESS)}
              >
                {t('newAddress')}
              </RadioCard>
            </div>
          ) : null}
          {err('buyerAddressId') ? (
            <p className="text-sm text-destructive">{err('buyerAddressId')}</p>
          ) : null}
          <input type="hidden" name="buyerAddressId" value={newAddress ? '' : addressChoice} />
          {newAddress ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <AddressFields
                regions={props.regions}
                defaults={{ region: 'AGU' }}
                error={err}
                layout="compact"
                idPrefix="request-"
              />
              <Field
                id="request-address-notes"
                label={t('addressNotes')}
                error={err('deliveryNotes')}
                className="sm:col-span-2"
              >
                <Input
                  {...controlProps('request-address-notes', err('deliveryNotes'))}
                  name="deliveryNotes"
                  maxLength={500}
                />
              </Field>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <Field
        id="request-message"
        label={kind === 'CUSTOM' ? t('messageRequired') : t('message')}
        hint={t('messageHint')}
        error={err('message')}
        required={kind === 'CUSTOM'}
      >
        <Textarea
          {...controlProps('request-message', err('message'), kind === 'CUSTOM')}
          name="message"
          maxLength={SERVICE_REQUEST_LIMITS.message}
          rows={4}
          required={kind === 'CUSTOM'}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('photos', { max: SERVICE_REQUEST_LIMITS.photos })}</p>
        <p className="text-sm text-muted-foreground">{t('photosHint')}</p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="service-request-photos"
          onChange={(event) => pickFiles(event.target.files)}
        />
        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3 text-sm"
              >
                <span className="max-w-48 truncate">{file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('removePhoto', { name: file.name })}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length < SERVICE_REQUEST_LIMITS.photos ? (
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            <ImagePlus aria-hidden="true" />
            {t('addPhotos')}
          </Button>
        ) : null}
        {err('photos') ? <p className="text-sm text-destructive">{err('photos')}</p> : null}
      </div>

      <Field
        id="request-phone"
        label={t('contactPhone')}
        hint={t('contactPhoneHint')}
        error={err('contactPhone')}
        required
        className="sm:max-w-sm"
      >
        <Input
          {...controlProps('request-phone', err('contactPhone'), true)}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={props.buyer.phone}
          required
        />
      </Field>

      <p className="text-sm text-muted-foreground">{t('notBinding')}</p>

      <Button type="submit" disabled={busy} aria-busy={busy} className="w-fit">
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send />}
        {t('submit')}
      </Button>
    </form>
  );
}
