'use client';

import { Ban, LoaderCircle, Route, Trash, TriangleExclamationPoint, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  ORDER_LIMITS,
  ORDER_PAYMENT_INPUT_KINDS,
  PAYMENT_METHODS,
  isClosedOn,
  isCurrencyCode,
  minorToDecimalString,
  quoteDeliveryFee,
  readCoordinates,
  type Coordinates,
  type DeliveryFeeTier,
  type FulfillmentMode,
  type OrderStatus,
  type SaleUnit,
} from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { RadioCard } from '@/components/form/radio-card';
import { AddressFields } from '@/components/form/address-fields';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
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
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { money } from '@/lib/format';
import { isBackStep } from '@/lib/order-ui';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface SavedAddressOption {
  readonly id: string;
  /** Una riga: etichetta, via e colonia. */
  readonly label: string;
  /** Posizione ancora valida (Google Places), per il costo per distanza; o null. */
  readonly coordinates: Coordinates | null;
}

/** Fasce di distanza e posizione della tienda (ADR-069), per "Calcular por distancia". */
export interface DistancePricing {
  readonly origin: Coordinates;
  readonly tiers: readonly DeliveryFeeTier[];
  readonly defaultFeeMinor: number;
}

export interface FulfillmentDefaults {
  readonly fulfillmentMode: FulfillmentMode;
  readonly scheduledDate: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Indirizzo scelto: ID della rubrica, 'new' per uno nuovo. */
  readonly addressChoice: string;
  readonly address: Partial<
    Record<
      | 'addressLine1'
      | 'addressLine2'
      | 'neighborhood'
      | 'postalCode'
      | 'city'
      | 'region'
      | 'placeId',
      string
    >
  >;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly deliveryNotes: string;
  readonly cardMessage: string;
  readonly cardSignature: string;
  readonly cardAnonymous: boolean;
  readonly deliveryFee: string;
  readonly notes: string;
}

const NEW_ADDRESS = 'new';
const ALL_DAY = 'all';
const CUSTOM_WINDOW = 'custom';

/** Fascia della fioreria (ADR-055), "HH:MM". */
export interface WindowOption {
  readonly start: string;
  readonly end: string;
  /** Già formattata ("09:00 a 12:00"). */
  readonly label: string;
}

function windowKey(window: { readonly start: string; readonly end: string }): string {
  return `${window.start}-${window.end}`;
}

/**
 * Consegna, destinatario e tarjeta: stessi campi per "Convertir en pedido" e per la modifica.
 * L'indirizzo nuovo compare solo quando serve, così i suoi campi obbligatori non bloccano il form.
 */
export function FulfillmentForm({
  action,
  defaults,
  addresses,
  regions,
  currency,
  dateMin,
  submitLabel,
  formKey,
  windows,
  closedWeekdays,
  distance = null,
}: {
  readonly action: Action;
  readonly defaults: FulfillmentDefaults;
  readonly addresses: readonly SavedAddressOption[];
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly currency: string;
  readonly dateMin: string;
  readonly submitLabel: string;
  /** Cambia quando il server modifica i valori salvati. */
  readonly formKey?: string;
  /** Fasce della fioreria: scelte rapide (resta "Otro horario"). Vuoto = solo Desde/Hasta. */
  readonly windows: readonly WindowOption[];
  /** Giorni di chiusura (0 = domenica): avviso, non blocco. */
  readonly closedWeekdays: readonly number[];
  /** Con le fasce di distanza: pulsante che propone il costo (si può sempre cambiare). */
  readonly distance?: DistancePricing | null;
}) {
  const t = useTranslations('orders');
  const [state, formAction] = useToastActionState(action);
  const feeRef = useRef<HTMLInputElement>(null);
  const [distanceNote, setDistanceNote] = useState<string | null>(null);
  const err = (field: string) => fieldError(state, field);
  const [mode, setMode] = useState<FulfillmentMode>(defaults.fulfillmentMode);
  const [addressChoice, setAddressChoice] = useState(
    addresses.length === 0 ? NEW_ADDRESS : defaults.addressChoice,
  );
  const [anonymous, setAnonymous] = useState(defaults.cardAnonymous);
  const newAddress = addressChoice === NEW_ADDRESS;
  const [date, setDate] = useState(defaults.scheduledDate);
  const [windowChoice, setWindowChoice] = useState(() => {
    if (!defaults.windowStart && !defaults.windowEnd) return ALL_DAY;
    const saved = windows.find(
      (window) => window.start === defaults.windowStart && window.end === defaults.windowEnd,
    );
    return saved ? windowKey(saved) : CUSTOM_WINDOW;
  });
  const chosenWindow = windows.find((window) => windowKey(window) === windowChoice);
  const closedDay = isClosedOn(date, closedWeekdays);

  return (
    <form
      key={formKey}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-6"
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('form.mode')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['DELIVERY', 'PICKUP'] as const).map((option) => (
            <RadioCard
              key={option}
              name="fulfillmentMode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
            >
              {t(`modes.${option}`)}
            </RadioCard>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4">
        <Field
          id="order-date"
          label={t('form.date')}
          error={err('scheduledDate')}
          required
          className="sm:max-w-56"
        >
          <Input
            {...controlProps('order-date', err('scheduledDate'))}
            name="scheduledDate"
            type="date"
            min={dateMin}
            defaultValue={defaults.scheduledDate}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </Field>
        {closedDay ? (
          <Alert variant="warning">
            <TriangleExclamationPoint aria-hidden="true" />
            <AlertDescription>{t('form.closedDay')}</AlertDescription>
          </Alert>
        ) : null}

        {windows.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('form.window')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { key: ALL_DAY, label: t('allDay') },
                ...windows.map((window) => ({ key: windowKey(window), label: window.label })),
                { key: CUSTOM_WINDOW, label: t('form.customWindow') },
              ].map((option) => (
                <RadioCard
                  key={option.key}
                  name="windowChoice"
                  value={option.key}
                  checked={windowChoice === option.key}
                  onChange={() => setWindowChoice(option.key)}
                >
                  <span className="tabular-nums">{option.label}</span>
                </RadioCard>
              ))}
            </div>
            {windowChoice === CUSTOM_WINDOW ? null : (
              <>
                <input type="hidden" name="windowStart" value={chosenWindow?.start ?? ''} />
                <input type="hidden" name="windowEnd" value={chosenWindow?.end ?? ''} />
              </>
            )}
          </fieldset>
        ) : null}

        {windows.length === 0 || windowChoice === CUSTOM_WINDOW ? (
          // items-start: il suggerimento sotto "Desde" non deve spostare "Hasta".
          <div className="grid grid-cols-2 items-start gap-4 sm:max-w-md">
            <Field
              id="order-window-start"
              label={t('form.windowStart')}
              error={err('windowStart')}
              hint={windows.length === 0 ? t('form.windowHint') : undefined}
            >
              <Input
                {...controlProps('order-window-start', err('windowStart'), windows.length === 0)}
                name="windowStart"
                type="time"
                step={900}
                defaultValue={defaults.windowStart}
              />
            </Field>
            <Field id="order-window-end" label={t('form.windowEnd')} error={err('windowEnd')}>
              <Input
                {...controlProps('order-window-end', err('windowEnd'))}
                name="windowEnd"
                type="time"
                step={900}
                defaultValue={defaults.windowEnd}
              />
            </Field>
          </div>
        ) : null}
      </div>

      {mode === 'DELIVERY' ? (
        <div className="grid gap-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('form.address')}</legend>
            {addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('form.noAddresses')}</p>
            ) : (
              <div className="grid gap-2">
                {addresses.map((address) => (
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
                  {t('form.newAddress')}
                </RadioCard>
              </div>
            )}
            {err('customerAddressId') ? (
              <p className="text-sm text-destructive">{err('customerAddressId')}</p>
            ) : null}
          </fieldset>
          <input type="hidden" name="customerAddressId" value={newAddress ? '' : addressChoice} />
          {newAddress ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <AddressFields
                regions={regions}
                defaults={defaults.address}
                error={err}
                layout="compact"
                idPrefix="order-"
              />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="order-recipient"
              label={t('form.recipientName')}
              error={err('recipientName')}
              hint={newAddress ? undefined : t('form.recipientHint')}
            >
              <Input
                {...controlProps('order-recipient', err('recipientName'), !newAddress)}
                name="recipientName"
                defaultValue={defaults.recipientName}
                maxLength={120}
              />
            </Field>
            <Field
              id="order-recipient-phone"
              label={t('form.recipientPhone')}
              error={err('recipientPhone')}
            >
              <Input
                {...controlProps('order-recipient-phone', err('recipientPhone'))}
                name="recipientPhone"
                type="tel"
                inputMode="tel"
                defaultValue={defaults.recipientPhone}
              />
            </Field>
          </div>
          <Field
            id="order-delivery-notes"
            label={t('form.deliveryNotes')}
            error={err('deliveryNotes')}
          >
            <Input
              {...controlProps('order-delivery-notes', err('deliveryNotes'))}
              name="deliveryNotes"
              defaultValue={defaults.deliveryNotes}
              placeholder={t('form.deliveryNotesPlaceholder')}
              maxLength={500}
            />
          </Field>
          <Field
            id="order-delivery-fee"
            label={t('form.deliveryFee', { currency })}
            error={err('deliveryFee')}
            className="max-w-56"
          >
            <Input
              {...controlProps('order-delivery-fee', err('deliveryFee'))}
              ref={feeRef}
              name="deliveryFee"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={defaults.deliveryFee}
              placeholder="0"
            />
          </Field>
          {distance ? (
            <div className="-mt-2 grid gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  const field = (name: string) =>
                    (form?.elements.namedItem(name) as HTMLInputElement | null)?.value;
                  const to = newAddress
                    ? readCoordinates(field('latitude'), field('longitude'))
                    : (addresses.find((address) => address.id === addressChoice)?.coordinates ??
                      null);
                  const quote = quoteDeliveryFee({
                    tiers: distance.tiers,
                    defaultFeeMinor: distance.defaultFeeMinor,
                    from: distance.origin,
                    to,
                  });
                  if (quote.kind === 'distance') {
                    if (feeRef.current && isCurrencyCode(currency)) {
                      feeRef.current.value = minorToDecimalString(quote.feeMinor, currency);
                    }
                    setDistanceNote(
                      t('form.distanceFee', {
                        km: quote.distanceKm,
                        fee: money(quote.feeMinor, currency),
                      }),
                    );
                  } else if (quote.kind === 'out_of_zone') {
                    setDistanceNote(
                      t('form.distanceOutOfZone', { km: quote.distanceKm, max: quote.maxKm }),
                    );
                  } else {
                    setDistanceNote(t('form.distanceUnknown'));
                  }
                }}
              >
                <Route />
                {t('form.distanceButton')}
              </Button>
              {distanceNote ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {distanceNote}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-medium">{t('form.card')}</legend>
        <Field id="order-card-message" label={t('form.cardMessage')} error={err('cardMessage')}>
          <Textarea
            {...controlProps('order-card-message', err('cardMessage'))}
            name="cardMessage"
            defaultValue={defaults.cardMessage}
            placeholder={t('form.cardMessagePlaceholder')}
            maxLength={ORDER_LIMITS.cardMessage}
            rows={3}
          />
        </Field>
        <div className="grid items-end gap-4 sm:grid-cols-2">
          <Field
            id="order-card-signature"
            label={t('form.cardSignature')}
            error={err('cardSignature')}
          >
            <Input
              {...controlProps('order-card-signature', err('cardSignature'))}
              name="cardSignature"
              defaultValue={defaults.cardSignature}
              maxLength={ORDER_LIMITS.cardSignature}
              disabled={anonymous}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              name="cardAnonymous"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            {t('form.cardAnonymous')}
          </label>
        </div>
      </fieldset>

      <Field
        id="order-notes"
        label={t('form.notes')}
        error={err('notes')}
        hint={t('form.notesHint')}
      >
        <Textarea
          {...controlProps('order-notes', err('notes'), true)}
          name="notes"
          defaultValue={defaults.notes}
          maxLength={ORDER_LIMITS.notes}
          rows={3}
        />
      </Field>

      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

/** Pulsante di un form con più invii: l'attesa compare solo sul pulsante premuto. */
function StepButton({
  status,
  back,
  shortage = false,
}: {
  readonly status: OrderStatus;
  readonly back: boolean;
  /** "Listo" con la merce che non basta: il testo dice che si conferma lo stesso. */
  readonly shortage?: boolean;
}) {
  const t = useTranslations('orders.detail');
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get('status') === status;
  return (
    <Button
      type="submit"
      name="status"
      value={status}
      variant={back ? 'ghost' : 'default'}
      disabled={pending}
      aria-busy={mine}
      className="w-full"
    >
      {mine ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : back ? (
        <Undo2 aria-hidden="true" />
      ) : null}
      {back
        ? t(`back.${status as 'CONFIRMED'}`)
        : shortage
          ? t('forwardShortage')
          : t(`forward.${status as 'READY'}`)}
    </Button>
  );
}

/** Un prodotto per cui la merce dell'inventario non basta per l'ordine (ADR-071). */
export interface StepShortage {
  readonly catalogItemId: string;
  readonly name: string;
  readonly saleUnit: SaleUnit;
  readonly missing: number;
}

/**
 * Passi consentiti (calcolati dal servizio, che li riverifica), avanti prima e correzioni dopo.
 * Se per "Listo" la merce non basta (`shortages`, solo sulla scheda dell'ordine), l'avviso dice cosa
 * manca e premere "Listo" conferma lo scarico lo stesso, come negli usi dell'inventario (ADR-060).
 */
export function OrderStepActions({
  action,
  current,
  steps,
  shortages = [],
}: {
  readonly action: Action;
  readonly current: OrderStatus;
  readonly steps: readonly OrderStatus[];
  readonly shortages?: readonly StepShortage[];
}) {
  const t = useTranslations('orders.detail');
  const tInventory = useTranslations('inventory');
  const [, formAction] = useToastActionState(action);
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">{t('noSteps')}</p>;
  const ordered = [...steps].sort(
    (a, b) => Number(isBackStep(current, a)) - Number(isBackStep(current, b)),
  );
  const shortage = shortages.length > 0 && steps.includes('READY');
  return (
    <form action={formAction} className="grid gap-2">
      {shortage ? (
        <>
          <Alert variant="warning" data-testid="order-shortage">
            <TriangleExclamationPoint aria-hidden="true" />
            <AlertDescription>
              <p>{t('shortage')}</p>
              <ul className="mt-1 list-disc pl-5">
                {shortages.map((line) => (
                  <li key={line.catalogItemId}>
                    {t('shortageItem', {
                      name: line.name,
                      missing: tInventory('quantity', { unit: line.saleUnit, count: line.missing }),
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-1">{t('shortageConfirm')}</p>
            </AlertDescription>
          </Alert>
          <input type="hidden" name="confirmShortage" value="on" />
        </>
      ) : null}
      {ordered.map((status) => (
        <StepButton
          key={status}
          status={status}
          back={isBackStep(current, status)}
          shortage={shortage && status === 'READY'}
        />
      ))}
    </form>
  );
}

/** Annullare chiede il motivo, che resta nella cronologia. */
/**
 * "Cancelar pedido". Per un ordine della tienda en línea il motivo arriva a chi compra per email:
 * `online` lo dice, `reject` è il rifiuto di un ordine ancora da accettare (ADR-067).
 */
export function CancelOrderDialog({
  action,
  variant = 'cancel',
}: {
  readonly action: Action;
  readonly variant?: 'cancel' | 'online' | 'reject';
}) {
  const t = useTranslations('orders.detail');
  const to = useTranslations('orders.online');
  const tc = useTranslations('common');
  const reject = variant === 'reject';
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = fieldError(state, 'reason');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={reject ? 'outline' : 'ghost'}
          className="w-full text-destructive hover:text-destructive"
        >
          <Ban />
          {reject ? to('reject') : t('cancel')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{reject ? to('rejectTitle') : t('cancelTitle')}</DialogTitle>
          <DialogDescription>
            {reject
              ? to('rejectBody')
              : variant === 'online'
                ? `${t('cancelBody')} ${to('cancelNotice')}`
                : t('cancelBody')}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field
            id="cancel-reason"
            label={variant === 'cancel' ? t('cancelReason') : to('rejectReason')}
            error={err}
            required
          >
            <Textarea
              {...controlProps('cancel-reason', err)}
              name="reason"
              maxLength={ORDER_LIMITS.cancelReason}
              rows={3}
              required
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {reject ? to('rejectConfirm') : t('cancelConfirm')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentForm({
  action,
  currency,
  today,
  defaultAmount,
  defaultKind,
}: {
  readonly action: Action;
  readonly currency: string;
  /** "AAAA-MM-GG": un pagamento non può essere nel futuro. */
  readonly today: string;
  /** Proposta: quanto manca da incassare. */
  readonly defaultAmount: string;
  readonly defaultKind: 'DEPOSIT' | 'BALANCE';
}) {
  const t = useTranslations('orders');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      key={`${defaultAmount}-${defaultKind}`}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field
          id="payment-amount"
          label={t('detail.amount', { currency })}
          error={err('amount')}
          required
        >
          <Input
            {...controlProps('payment-amount', err('amount'))}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={defaultAmount}
            required
          />
        </Field>
        <Field id="payment-kind" label={t('detail.kind')} error={err('kind')}>
          <NativeSelect
            {...controlProps('payment-kind', err('kind'))}
            name="kind"
            defaultValue={defaultKind}
          >
            {ORDER_PAYMENT_INPUT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`paymentKinds.${kind}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="payment-method" label={t('detail.method')} error={err('method')}>
          <NativeSelect
            {...controlProps('payment-method', err('method'))}
            name="method"
            defaultValue="CASH"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`methods.${method}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="payment-date" label={t('detail.paidOn')} error={err('paidOn')}>
          <Input
            {...controlProps('payment-date', err('paidOn'))}
            name="paidOn"
            type="date"
            max={today}
            defaultValue={today}
          />
        </Field>
      </div>
      <Field id="payment-reference" label={t('detail.reference')} error={err('reference')}>
        <Input
          {...controlProps('payment-reference', err('reference'))}
          name="reference"
          maxLength={ORDER_LIMITS.paymentReference}
          placeholder={t('detail.referencePlaceholder')}
        />
      </Field>
      <div>
        <SubmitButton variant="secondary">{t('detail.addPayment')}</SubmitButton>
      </div>
    </form>
  );
}

export function ReversePaymentButton({
  action,
  label,
}: {
  readonly action: Action;
  /** Nome accessibile con l'importo ("Anular el pago de $200.00"). */
  readonly label: string;
}) {
  const t = useTranslations('orders.detail');
  return (
    <ConfirmActionDialog
      action={action}
      trigger={
        <Button variant="ghost" size="sm" aria-label={label}>
          {t('reverse')}
        </Button>
      }
      title={t('reverseTitle')}
      description={t('reverseBody')}
      confirmLabel={t('reverseConfirm')}
    />
  );
}

/** Sconto sull'ordine: il servizio lo limita al subtotale e non lo lascia sotto il già pagato. */
export function OrderDiscountForm({
  action,
  currency,
  defaultValue,
}: {
  readonly action: Action;
  readonly currency: string;
  /** Importo salvato, già in formato decimale ("20.00"); vuoto se non c'è sconto. */
  readonly defaultValue: string;
}) {
  const t = useTranslations('orders.draft');
  const [state, formAction] = useToastActionState(action);
  const err = fieldError(state, 'discount');
  return (
    <form
      key={defaultValue}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="flex flex-wrap items-end gap-2"
    >
      <Field id="order-discount" label={t('discountField', { currency })} error={err}>
        <Input
          {...controlProps('order-discount', err)}
          name="discount"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          className="w-36"
        />
      </Field>
      <SubmitButton variant="secondary">{t('saveDiscount')}</SubmitButton>
    </form>
  );
}

/** "Descartar borrador": con conferma, senza motivo (il borrador non è mai stato un ordine). */
export function DiscardDraftButton({ action }: { readonly action: Action }) {
  const t = useTranslations('orders.draft');
  return (
    <ConfirmActionDialog
      action={action}
      trigger={
        <Button variant="ghost" className="text-destructive hover:text-destructive">
          <Trash aria-hidden="true" />
          {t('discard')}
        </Button>
      }
      title={t('discardTitle')}
      description={t('discardBody')}
      confirmLabel={t('discardConfirm')}
    />
  );
}

/** Repartidor di un ordine a domicilio (ADR-058): un membro della squadra, o nessuno. */
export function AssignForm({
  action,
  options,
  current,
}: {
  readonly action: Action;
  readonly options: readonly { readonly membershipId: string; readonly name: string }[];
  readonly current: string | null;
}) {
  const t = useTranslations('orders.assign');
  const [state, formAction] = useToastActionState(action);
  const err = fieldError(state, 'assignee');
  return (
    <form
      key={current ?? 'none'}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="flex flex-wrap items-end gap-2"
    >
      <Field id="order-assignee" label={t('label')} error={err} className="min-w-48 flex-1">
        <NativeSelect
          {...controlProps('order-assignee', err)}
          name="assignee"
          defaultValue={current ?? ''}
        >
          <option value="">{t('nobody')}</option>
          {options.map((option) => (
            <option key={option.membershipId} value={option.membershipId}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SubmitButton variant="secondary">{t('save')}</SubmitButton>
    </form>
  );
}
