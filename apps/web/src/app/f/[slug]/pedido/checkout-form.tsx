'use client';

import {
  ArrowLeft,
  ArrowRight,
  Flower2,
  Minus,
  Plus,
  Send,
  TriangleExclamationPoint,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  MARKETPLACE_ORDER_LIMITS,
  ORDER_LIMITS,
  isClosedOn,
  type Availability,
  type SaleUnit,
  type StorePaymentMethod,
} from '@floral/domain';
import { StepIndicator } from '@/components/common/step-indicator';
import { AddressFields } from '@/components/form/address-fields';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { RadioCard } from '@/components/form/radio-card';
import { SubmitButton } from '@/components/form/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { money } from '@/lib/format';
import { firstInvalidControl, firstStepWithError, focusFirstControl } from '@/lib/form-steps';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { calendarDate } from '@/lib/quote-ui';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface CheckoutItem {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly saleUnit: SaleUnit;
  readonly availability: Availability;
  readonly photoSrc: string | null;
}

const STEPS = ['products', 'delivery', 'card', 'confirm'] as const;
const NEW_ADDRESS = 'new';
const CARD_FIELDS = new Set(['cardMessage', 'cardSignature', 'cardAnonymous', 'buyerNotes']);

/** Passo di un campo con un errore del server. */
function stepOfField(name: string): number {
  if (name === 'lines' || name.startsWith('qty')) return 0;
  if (CARD_FIELDS.has(name)) return 2;
  if (name === 'contactPhone' || name === '_form') return 3;
  return 1;
}

/**
 * Modulo "Hacer pedido" in quattro passi dentro un solo `<form>` (ADR-044): 1) prodotti e quantità,
 * 2) consegna o ritiro, giorno, fascia e indirizzo, 3) tarjeta e commenti, 4) riepilogo, telefono
 * e invio. Il totale mostrato è indicativo: lo ricalcola il server con il catalogo.
 */
export function CheckoutForm({
  action,
  locale,
  store,
  items,
  delivery,
  buyer,
  regions,
  preselected,
}: {
  readonly action: Action;
  readonly locale: string;
  readonly store: {
    readonly name: string;
    readonly currency: string;
    readonly pickupAddress: string | null;
    readonly paymentMethods: readonly StorePaymentMethod[];
    readonly paymentInstructions: string | null;
  };
  readonly items: readonly CheckoutItem[];
  readonly delivery: {
    readonly windows: readonly { readonly start: string; readonly end: string }[];
    readonly closedWeekdays: readonly number[];
    readonly feeMinor: number;
    readonly minDate: string;
    readonly maxDate: string;
  };
  readonly buyer: {
    readonly phone: string;
    readonly email: string;
    readonly addresses: readonly { readonly id: string; readonly label: string }[];
  };
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly preselected: string | null;
}) {
  const t = useTranslations('checkout');
  const ts = useTranslations('steps');
  const tStore = useTranslations('publicStore');
  const format = useFormatter();
  const [state, formAction] = useActionState(action, idleState);
  const err = (field: string) => fieldError(state, field);
  const fmt = (minor: number) => money(minor, store.currency, locale);

  const [step, setStep] = useState(0);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    preselected && items.some((item) => item.id === preselected) ? { [preselected]: 1 } : {},
  );
  const [productsError, setProductsError] = useState(false);
  const [mode, setMode] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [date, setDate] = useState('');
  const [windowChoice, setWindowChoice] = useState('');
  const [addressChoice, setAddressChoice] = useState(buyer.addresses[0]?.id ?? NEW_ADDRESS);
  const [anonymous, setAnonymous] = useState(false);
  const [newAddressText, setNewAddressText] = useState('');

  const productsSection = useRef<HTMLDivElement>(null);
  const deliverySection = useRef<HTMLDivElement>(null);
  const cardSection = useRef<HTMLDivElement>(null);
  const confirmSection = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Errori del server: si apre il primo passo che ne ha uno (aggiornando lo stato durante il
  // render quando arriva un nuovo esito, come consiglia React, senza effetti).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const errorStep =
      state.status === 'error' ? firstStepWithError(state.fieldErrors, stepOfField) : null;
    if (errorStep !== null) setStep(errorStep);
  }

  const chosen = items.filter((item) => (quantities[item.id] ?? 0) > 0);
  const subtotal = chosen.reduce((sum, item) => sum + item.priceMinor * quantities[item.id]!, 0);
  const fee = mode === 'DELIVERY' ? delivery.feeMinor : 0;
  const closedDay = date !== '' && isClosedOn(date, delivery.closedWeekdays);
  const newAddress = addressChoice === NEW_ADDRESS;
  const savedAddress = buyer.addresses.find((address) => address.id === addressChoice);
  const windowLabel = windowChoice
    ? t('windowRange', {
        start: windowChoice.split('-')[0] ?? '',
        end: windowChoice.split('-')[1] ?? '',
      })
    : t('anyTime');

  function sectionOf(index: number): HTMLDivElement | null {
    if (index === 0) return productsSection.current;
    if (index === 1) return deliverySection.current;
    if (index === 2) return cardSection.current;
    return confirmSection.current;
  }

  function setQuantity(itemId: string, value: number) {
    const next = Math.min(
      Math.max(Math.trunc(value) || 0, 0),
      MARKETPLACE_ORDER_LIMITS.quantityMax,
    );
    setQuantities((current) => ({ ...current, [itemId]: next }));
    if (next > 0) setProductsError(false);
  }

  function onDateChange(value: string) {
    setDate(value);
    // Un giorno di chiusura blocca il passo (il server lo rifiuta comunque).
    dateRef.current?.setCustomValidity(
      value !== '' && isClosedOn(value, delivery.closedWeekdays) ? t('closedDay') : '',
    );
  }

  function goTo(next: number) {
    if (next === 3) {
      // Riepilogo: l'indirizzo nuovo come l'ha scritto chi compra.
      const value = (name: string) =>
        (formRef.current?.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
      setNewAddressText(
        [value('addressLine1'), value('neighborhood'), value('city')].filter(Boolean).join(', '),
      );
    }
    flushSync(() => setStep(next));
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    focusFirstControl(sectionOf(next));
  }

  /** Controlli del browser e regole del passo; false se il passo non è a posto. */
  function checkStep(index: number): boolean {
    if (index === 0 && chosen.length === 0) {
      flushSync(() => {
        setStep(0);
        setProductsError(true);
      });
      return false;
    }
    const invalid = firstInvalidControl(sectionOf(index));
    if (invalid) {
      flushSync(() => setStep(index));
      invalid.reportValidity();
      return false;
    }
    return true;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Invio (anche con il tasto Enter) prima dell'ultimo passo = "Continuar".
    if (step < 3) {
      event.preventDefault();
      if (checkStep(step)) goTo(step + 1);
      return;
    }
    for (const index of [0, 1, 2, 3]) {
      if (!checkStep(index)) {
        event.preventDefault();
        return;
      }
    }
    preserveOnSubmit(formAction)(event);
  }

  const nav = (index: number) => (
    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {index > 0 ? (
        <Button type="button" variant="ghost" onClick={() => goTo(index - 1)}>
          <ArrowLeft />
          {ts('back')}
        </Button>
      ) : (
        <span />
      )}
      {index < 3 ? (
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          {ts('continue')}
          <ArrowRight />
        </Button>
      ) : (
        <SubmitButton
          size="lg"
          className="w-full sm:w-auto"
          icon={<Send />}
          pendingLabel={t('sending')}
        >
          {t('send')}
        </SubmitButton>
      )}
    </div>
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      className="mt-6 max-w-3xl space-y-6"
    >
      <div ref={top} className="scroll-mt-6">
        <StepIndicator
          steps={STEPS.map((key) => ({ key, label: t(`steps.${key}`) }))}
          current={step}
          reachable={step}
          onSelect={goTo}
        />
      </div>
      <FormAlert state={state} />

      {/* 1. Prodotti */}
      <div ref={productsSection} hidden={step !== 0}>
        <Card>
          <CardHeader>
            <CardTitle>{t('steps.products')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y">
              {items.map((item) => {
                const quantity = quantities[item.id] ?? 0;
                const inputId = `qty-${item.id}`;
                return (
                  <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                      {item.photoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app, già ridotte.
                        <img
                          src={item.photoSrc}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <Flower2 className="size-6 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <label htmlFor={inputId} className="block text-sm font-medium">
                        {item.name}
                      </label>
                      <span className="block text-sm text-muted-foreground tabular-nums">
                        {item.saleUnit === 'PIECE'
                          ? fmt(item.priceMinor)
                          : tStore('pricePerUnit', {
                              price: fmt(item.priceMinor),
                              unit: tStore(`units.${item.saleUnit}`),
                            })}
                      </span>
                      {item.availability !== 'AVAILABLE' ? (
                        <Badge variant="warning" className="mt-1">
                          {tStore(`availability.${item.availability}`)}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('less', { name: item.name })}
                        disabled={quantity === 0}
                        onClick={() => setQuantity(item.id, quantity - 1)}
                      >
                        <Minus />
                      </Button>
                      <Input
                        id={inputId}
                        name={`qty.${item.id}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MARKETPLACE_ORDER_LIMITS.quantityMax}
                        step={1}
                        value={quantity}
                        onChange={(event) => setQuantity(item.id, Number(event.target.value))}
                        className="w-14 text-center tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('more', { name: item.name })}
                        disabled={quantity >= MARKETPLACE_ORDER_LIMITS.quantityMax}
                        onClick={() => setQuantity(item.id, quantity + 1)}
                      >
                        <Plus />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {productsError || err('lines') ? (
              <p className="text-sm text-destructive" role="alert">
                {err('lines') ?? t('chooseProduct')}
              </p>
            ) : null}
            <p className="flex justify-between border-t pt-3 text-sm font-medium">
              <span>{t('subtotal')}</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </p>
          </CardContent>
        </Card>
        {nav(0)}
      </div>

      {/* 2. Consegna */}
      <div ref={deliverySection} hidden={step !== 1}>
        <Card>
          <CardHeader>
            <CardTitle>{t('steps.delivery')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{t('mode')}</legend>
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
              {mode === 'PICKUP' && store.pickupAddress ? (
                <p className="text-sm text-muted-foreground">
                  {t('pickupAt', { address: store.pickupAddress })}
                </p>
              ) : null}
            </fieldset>

            <div className="grid gap-2">
              <Field
                id="checkout-date"
                label={mode === 'DELIVERY' ? t('dateDelivery') : t('datePickup')}
                error={err('scheduledDate')}
                hint={t('dateHint')}
                required
                className="sm:max-w-56"
              >
                <Input
                  {...controlProps('checkout-date', err('scheduledDate'), true)}
                  ref={dateRef}
                  name="scheduledDate"
                  type="date"
                  min={delivery.minDate}
                  max={delivery.maxDate}
                  value={date}
                  onChange={(event) => onDateChange(event.target.value)}
                  required
                />
              </Field>
              {closedDay ? (
                <Alert variant="warning">
                  <TriangleExclamationPoint aria-hidden="true" />
                  <AlertDescription>{t('closedDay')}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            {delivery.windows.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">{t('window')}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { key: '', label: t('anyTime') },
                    ...delivery.windows.map((window) => ({
                      key: `${window.start}-${window.end}`,
                      label: t('windowRange', { start: window.start, end: window.end }),
                    })),
                  ].map((option) => (
                    <RadioCard
                      key={option.key || 'any'}
                      name="window"
                      value={option.key}
                      checked={windowChoice === option.key}
                      onChange={() => setWindowChoice(option.key)}
                    >
                      <span className="tabular-nums">{option.label}</span>
                    </RadioCard>
                  ))}
                </div>
                {err('window') ? <p className="text-sm text-destructive">{err('window')}</p> : null}
              </fieldset>
            ) : (
              <input type="hidden" name="window" value="" />
            )}

            {mode === 'DELIVERY' ? (
              <div className="grid gap-4">
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">{t('address')}</legend>
                  {buyer.addresses.length > 0 ? (
                    <div className="grid gap-2">
                      {buyer.addresses.map((address) => (
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
                </fieldset>
                <input
                  type="hidden"
                  name="buyerAddressId"
                  value={newAddress ? '' : addressChoice}
                />
                {newAddress ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <AddressFields
                        regions={regions}
                        defaults={{ region: 'AGU' }}
                        error={err}
                        layout="compact"
                        idPrefix="checkout-"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name="saveAddress" defaultChecked />
                      {t('saveAddress')}
                    </label>
                  </>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id="checkout-recipient"
                    label={t('recipientName')}
                    error={err('recipientName')}
                    hint={newAddress ? undefined : t('recipientHint')}
                  >
                    <Input
                      {...controlProps('checkout-recipient', err('recipientName'), !newAddress)}
                      name="recipientName"
                      autoComplete="off"
                      maxLength={120}
                    />
                  </Field>
                  <Field
                    id="checkout-recipient-phone"
                    label={t('recipientPhone')}
                    error={err('recipientPhone')}
                  >
                    <Input
                      {...controlProps('checkout-recipient-phone', err('recipientPhone'))}
                      name="recipientPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Field
                  id="checkout-delivery-notes"
                  label={t('deliveryNotes')}
                  error={err('deliveryNotes')}
                >
                  <Input
                    {...controlProps('checkout-delivery-notes', err('deliveryNotes'))}
                    name="deliveryNotes"
                    placeholder={t('deliveryNotesPlaceholder')}
                    maxLength={500}
                  />
                </Field>
              </div>
            ) : null}
          </CardContent>
        </Card>
        {nav(1)}
      </div>

      {/* 3. Tarjeta e commenti */}
      <div ref={cardSection} hidden={step !== 2}>
        <Card>
          <CardHeader>
            <CardTitle>{t('steps.card')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field
              id="checkout-card-message"
              label={t('cardMessage')}
              hint={t('cardMessageHint')}
              error={err('cardMessage')}
            >
              <Textarea
                {...controlProps('checkout-card-message', err('cardMessage'), true)}
                name="cardMessage"
                maxLength={ORDER_LIMITS.cardMessage}
                rows={3}
              />
            </Field>
            <div className="grid items-end gap-4 sm:grid-cols-2">
              <Field
                id="checkout-card-signature"
                label={t('cardSignature')}
                error={err('cardSignature')}
              >
                <Input
                  {...controlProps('checkout-card-signature', err('cardSignature'))}
                  name="cardSignature"
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
                {t('cardAnonymous')}
              </label>
            </div>
            <Field
              id="checkout-buyer-notes"
              label={t('buyerNotes')}
              hint={t('buyerNotesHint')}
              error={err('buyerNotes')}
            >
              <Textarea
                {...controlProps('checkout-buyer-notes', err('buyerNotes'), true)}
                name="buyerNotes"
                maxLength={MARKETPLACE_ORDER_LIMITS.buyerNotes}
                rows={2}
              />
            </Field>
          </CardContent>
        </Card>
        {nav(2)}
      </div>

      {/* 4. Riepilogo e invio */}
      <div ref={confirmSection} hidden={step !== 3}>
        <Card>
          <CardHeader>
            <CardTitle>{t('steps.confirm')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <ul className="divide-y text-sm">
              {chosen.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-2 first:pt-0">
                  <span>
                    <span className="tabular-nums">{quantities[item.id]} ×</span> {item.name}
                  </span>
                  <span className="tabular-nums">
                    {fmt(item.priceMinor * quantities[item.id]!)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="grid gap-2 border-t pt-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('subtotal')}</dt>
                <dd className="tabular-nums">{fmt(subtotal)}</dd>
              </div>
              {mode === 'DELIVERY' ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('deliveryFee')}</dt>
                  <dd className="text-right tabular-nums">
                    {fee > 0 ? fmt(fee) : t('feeToConfirm')}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 text-base font-semibold">
                <dt>{t('total')}</dt>
                <dd className="tabular-nums" data-testid="checkout-total">
                  {fmt(subtotal + fee)}
                </dd>
              </div>
            </dl>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t(`modes.${mode}`)}</dt>
                <dd>
                  <span className="inline-block first-letter:uppercase">
                    {date
                      ? format.dateTime(calendarDate(date), {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          timeZone: 'UTC',
                        })
                      : '—'}
                  </span>{' '}
                  · {windowLabel}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {mode === 'DELIVERY' ? t('address') : t('pickupWhere')}
                </dt>
                <dd>
                  {mode === 'PICKUP'
                    ? (store.pickupAddress ?? store.name)
                    : newAddress
                      ? newAddressText || '—'
                      : (savedAddress?.label ?? '—')}
                </dd>
              </div>
            </dl>

            <Field
              id="checkout-phone"
              label={t('contactPhone')}
              hint={t('contactPhoneHint')}
              error={err('contactPhone')}
              required
              className="sm:max-w-sm"
            >
              <Input
                {...controlProps('checkout-phone', err('contactPhone'), true)}
                name="contactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                defaultValue={buyer.phone}
                required
              />
            </Field>

            <div className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm">
              <p className="font-medium">{t('howItWorks')}</p>
              <p>
                {t('acceptFirst', { shop: store.name, days: MARKETPLACE_ORDER_LIMITS.acceptDays })}
              </p>
              <p>
                {store.paymentMethods.length > 0
                  ? t('payDirect', {
                      methods: store.paymentMethods
                        .map((method) => tStore(`payment.${method}`))
                        .join(', '),
                    })
                  : t('payDirectNoMethods')}
              </p>
              <p className="text-muted-foreground">
                {t('dataShared', { shop: store.name, email: buyer.email })}
              </p>
            </div>
          </CardContent>
        </Card>
        {nav(3)}
      </div>
    </form>
  );
}
