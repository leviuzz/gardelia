'use client';

import { Archive, Pencil, Plus, RotateCcw, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  CARE_FREQUENCIES,
  CARE_CHARGE_LIMITS,
  CARE_LIMITS,
  CARE_SERVICE_UNITS,
  DEAD_PLANT_POLICIES,
  MISSED_VISIT_POLICIES,
  estimateCareMonth,
  priceCareVisit,
  type CareFrequency,
  type CareServicePricing,
  type CareServiceUnit,
  type PlantSize,
} from '@floral/domain';
import { ActionButton } from '@/components/form/action-button';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
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
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';
import { CustomerNoticeCheckbox } from './customer-notice';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface Option {
  readonly value: number;
  readonly label: string;
}

const chip =
  'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

// -----------------------------------------------------------------------------
// Offerta
// -----------------------------------------------------------------------------

export interface CareOfferDefaults {
  readonly visitFee: string;
  readonly careFeeSmall: string;
  readonly careFeeMedium: string;
  readonly careFeeLarge: string;
  readonly frequencies: readonly CareFrequency[];
  readonly maxDistanceKm: string;
  readonly minNoticeHours: string;
  readonly missedVisitPolicy: string;
  readonly deadPlantPolicy: string;
  /** "Días para pagar" un cargo (ADR-079). */
  readonly paymentDueDays: string;
  readonly termsText: string;
}

/** Tariffe e regole di Floral Care: tariffa per uscita, care per misura, frequenze, raggio, termini. */
export function CareOfferForm({
  action,
  currency,
  defaults,
  deliveryRadiusKm,
  readOnly,
}: {
  readonly action: Action;
  readonly currency: string;
  readonly defaults: CareOfferDefaults;
  readonly deliveryRadiusKm: number | null;
  readonly readOnly: boolean;
}) {
  const t = useTranslations('care.offer');
  const tc = useTranslations('common');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  const sizes = [
    ['careFeeSmall', 'SMALL'],
    ['careFeeMedium', 'MEDIUM'],
    ['careFeeLarge', 'LARGE'],
  ] as const;
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-6">
      <fieldset disabled={readOnly} className="grid gap-6">
        <Field
          id="care-visit-fee"
          label={t('visitFee', { currency })}
          hint={t('visitFeeHint')}
          error={err('visitFee')}
          required
          className="max-w-xs"
        >
          <Input
            {...controlProps('care-visit-fee', err('visitFee'), true)}
            name="visitFee"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={defaults.visitFee}
            required
          />
        </Field>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">{t('careFees', { currency })}</legend>
          <p className="-mt-1 text-sm text-muted-foreground">{t('careFeesHint')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {sizes.map(([name, size]) => (
              <Field key={name} id={`care-${name}`} label={t(`sizes.${size}`)} error={err(name)}>
                <Input
                  {...controlProps(`care-${name}`, err(name))}
                  name={name}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  defaultValue={defaults[name]}
                />
              </Field>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t('frequencies')}</legend>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">{t('frequenciesHint')}</p>
          <div className="grid gap-2">
            {CARE_FREQUENCIES.map((frequency) => (
              <label key={frequency} className={chip}>
                <Checkbox
                  name="frequencies"
                  value={frequency}
                  defaultChecked={defaults.frequencies.includes(frequency)}
                />
                <span>
                  <span className="block font-medium">{t(`frequencyNames.${frequency}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`frequencyHints.${frequency}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {err('frequencies') ? (
            <p className="mt-2 text-sm text-destructive">{err('frequencies')}</p>
          ) : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="care-radius"
            label={t('maxDistanceKm')}
            hint={
              deliveryRadiusKm
                ? t('maxDistanceHintDelivery', { km: deliveryRadiusKm })
                : t('maxDistanceHint')
            }
            error={err('maxDistanceKm')}
          >
            <Input
              {...controlProps('care-radius', err('maxDistanceKm'), true)}
              name="maxDistanceKm"
              type="number"
              inputMode="numeric"
              min={1}
              max={CARE_LIMITS.maxDistanceKm}
              defaultValue={defaults.maxDistanceKm}
            />
          </Field>
          <Field
            id="care-notice"
            label={t('minNoticeHours')}
            hint={t('minNoticeHoursHint')}
            error={err('minNoticeHours')}
            required
          >
            <Input
              {...controlProps('care-notice', err('minNoticeHours'), true)}
              name="minNoticeHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={CARE_LIMITS.noticeHoursMax}
              defaultValue={defaults.minNoticeHours}
              required
            />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('missedVisit')}</legend>
          {MISSED_VISIT_POLICIES.map((policy) => (
            <label key={policy} className={chip}>
              <input
                type="radio"
                name="missedVisitPolicy"
                value={policy}
                defaultChecked={defaults.missedVisitPolicy === policy}
                className="size-4 accent-primary"
              />
              {t(`missedVisitPolicies.${policy}`)}
            </label>
          ))}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('deadPlant')}</legend>
          {DEAD_PLANT_POLICIES.map((policy) => (
            <label key={policy} className={chip}>
              <input
                type="radio"
                name="deadPlantPolicy"
                value={policy}
                defaultChecked={defaults.deadPlantPolicy === policy}
                className="size-4 accent-primary"
              />
              {t(`deadPlantPolicies.${policy}`)}
            </label>
          ))}
        </fieldset>

        <Field
          id="care-due-days"
          label={t('paymentDueDays')}
          hint={t('paymentDueDaysHint')}
          error={err('paymentDueDays')}
        >
          <Input
            {...controlProps('care-due-days', err('paymentDueDays'), true)}
            name="paymentDueDays"
            type="number"
            inputMode="numeric"
            min={CARE_CHARGE_LIMITS.dueDaysMin}
            max={CARE_CHARGE_LIMITS.dueDaysMax}
            defaultValue={defaults.paymentDueDays}
            className="sm:max-w-40"
          />
        </Field>

        <Field id="care-terms" label={t('terms')} hint={t('termsHint')} error={err('termsText')}>
          <Textarea
            {...controlProps('care-terms', err('termsText'), true)}
            name="termsText"
            rows={5}
            maxLength={CARE_LIMITS.termsText}
            defaultValue={defaults.termsText}
          />
        </Field>
      </fieldset>
      {readOnly ? null : (
        <div>
          <SubmitButton>{tc('save')}</SubmitButton>
        </div>
      )}
    </form>
  );
}

/**
 * Quanto paga un cliente con le tariffe salvate: il fiorista prova piante e frequenza e vede subito
 * il canone. Solo una stima (senza distanza né extra): il prezzo vero lo calcola il server alla
 * conferma del contratto.
 */
export function CareSimulator({
  currency,
  visitFeeMinor,
  careFees,
  frequencies,
}: {
  readonly currency: string;
  readonly visitFeeMinor: number;
  readonly careFees: Readonly<Record<PlantSize, number>>;
  readonly frequencies: readonly CareFrequency[];
}) {
  const t = useTranslations('care.simulator');
  const to = useTranslations('care.offer');
  const [plants, setPlants] = useState<Record<PlantSize, string>>({
    SMALL: '',
    MEDIUM: '10',
    LARGE: '',
  });
  const [frequency, setFrequency] = useState<CareFrequency>(frequencies[0] ?? 'MONTHLY_2');
  const [days, setDays] = useState('1');
  const count = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, CARE_LIMITS.plantQuantity) : 0;
  };
  const result = priceCareVisit({
    visitFeeMinor,
    travelSurchargeMinor: 0,
    careFees,
    plants: (['SMALL', 'MEDIUM', 'LARGE'] as const).map((size) => ({
      size,
      quantity: count(plants[size]),
    })),
    extras: [],
  });
  const weekdays = frequency === 'WEEKLY' ? Math.min(Math.max(count(days), 1), 3) : 1;
  const month = result.ok
    ? estimateCareMonth(result.price.perVisitMinor, frequency, weekdays)
    : null;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
        {(['SMALL', 'MEDIUM', 'LARGE'] as const).map((size) => (
          <Field key={size} id={`sim-${size}`} label={to(`sizes.${size}`)}>
            <Input
              id={`sim-${size}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={CARE_LIMITS.plantQuantity}
              value={plants[size]}
              onChange={(event) => setPlants({ ...plants, [size]: event.target.value })}
              placeholder="0"
            />
          </Field>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sim-frequency" label={t('frequency')}>
          <NativeSelect
            id="sim-frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as CareFrequency)}
          >
            {CARE_FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {to(`frequencyNames.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {frequency === 'WEEKLY' ? (
          <Field id="sim-days" label={t('daysPerWeek')}>
            <Input
              id="sim-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={CARE_LIMITS.weeklyDaysMax}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
      <div className="rounded-xl bg-muted/50 p-4" aria-live="polite">
        {result.ok && month ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('perVisit')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {money(result.price.perVisitMinor, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('perMonth')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {month.minMinor === month.maxMinor
                  ? money(month.minMinor, currency)
                  : t('range', {
                      min: money(month.minMinor, currency),
                      max: money(month.maxMinor, currency),
                    })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-destructive">{t('tooLarge')}</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t('note')}</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fasce di uscita
// -----------------------------------------------------------------------------

function SlotFields({
  idPrefix,
  weekdays,
  defaults,
  state,
  weekdayLocked,
}: {
  readonly idPrefix: string;
  readonly weekdays: readonly Option[];
  readonly defaults?: {
    readonly weekday: number;
    readonly start: string;
    readonly end: string;
    readonly capacity: number;
  };
  readonly state: ActionState;
  readonly weekdayLocked?: boolean;
}) {
  const t = useTranslations('care.slots');
  const err = (field: string) => fieldError(state, field);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field
        id={`${idPrefix}-weekday`}
        label={t('weekday')}
        error={err('weekday')}
        hint={weekdayLocked ? t('weekdayLocked') : undefined}
        required
        className="col-span-2 sm:col-span-1"
      >
        <NativeSelect
          {...controlProps(`${idPrefix}-weekday`, err('weekday'), weekdayLocked)}
          name="weekday"
          defaultValue={defaults ? String(defaults.weekday) : '2'}
        >
          {weekdays.map((day) => (
            <option key={day.value} value={String(day.value)}>
              {day.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${idPrefix}-start`} label={t('start')} error={err('start')} required>
        <Input
          {...controlProps(`${idPrefix}-start`, err('start'))}
          name="start"
          type="time"
          step={900}
          defaultValue={defaults?.start ?? '09:00'}
          required
        />
      </Field>
      <Field id={`${idPrefix}-end`} label={t('end')} error={err('end')} required>
        <Input
          {...controlProps(`${idPrefix}-end`, err('end'))}
          name="end"
          type="time"
          step={900}
          defaultValue={defaults?.end ?? '12:00'}
          required
        />
      </Field>
      <Field
        id={`${idPrefix}-capacity`}
        label={t('capacity')}
        error={err('capacity')}
        required
        className="col-span-2 sm:col-span-1"
      >
        <Input
          {...controlProps(`${idPrefix}-capacity`, err('capacity'))}
          name="capacity"
          type="number"
          inputMode="numeric"
          min={1}
          max={CARE_LIMITS.slotCapacity}
          defaultValue={defaults?.capacity ?? 2}
          required
        />
      </Field>
    </div>
  );
}

/** Nuova fascia: giorno della settimana, da–a, quante visite ci stanno. */
export function CareSlotAddForm({
  action,
  weekdays,
}: {
  readonly action: Action;
  readonly weekdays: readonly Option[];
}) {
  const t = useTranslations('care.slots');
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(action, () => setFormKey((key) => key + 1));
  return (
    <form
      key={formKey}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-3 rounded-xl border border-dashed p-4"
    >
      <p className="text-sm font-medium">{t('addTitle')}</p>
      <SlotFields idPrefix="slot-new" weekdays={weekdays} state={state} />
      <div>
        <SubmitButton variant="secondary" className="w-full sm:w-auto">
          <Plus />
          {t('add')}
        </SubmitButton>
      </div>
    </form>
  );
}

export interface CareSlotView {
  readonly id: string;
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
  readonly capacity: number;
  /** "Martes · 09:00–12:00" già formattato. */
  readonly label: string;
  readonly contracts: number;
  readonly upcomingVisits: number;
}

/** Cambia orario e capienza; con visite programmate chiede "Sí, avisé al cliente". */
export function CareSlotEditDialog({
  action,
  slot,
  weekdays,
}: {
  readonly action: Action;
  readonly slot: CareSlotView;
  readonly weekdays: readonly Option[];
}) {
  const t = useTranslations('care.slots');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('editLabel', { slot: slot.label })}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('editTitle', { slot: slot.label })}</DialogTitle>
          <DialogDescription>{t('editBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <SlotFields
            idPrefix={`slot-${slot.id}`}
            weekdays={weekdays}
            defaults={slot}
            state={state}
            weekdayLocked={slot.contracts > 0 || slot.upcomingVisits > 0}
          />
          {slot.upcomingVisits > 0 ? (
            <CustomerNoticeCheckbox
              id={`slot-${slot.id}-notice`}
              error={fieldError(state, 'customerNotified')}
              hint={t('editNotice', { count: slot.upcomingVisits })}
            />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{tc('saveChanges')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Archivia: le visite programmate cercano un altro posto (o restano da riprogrammare). */
export function CareSlotArchiveDialog({
  action,
  slot,
}: {
  readonly action: Action;
  readonly slot: CareSlotView;
}) {
  const t = useTranslations('care.slots');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('archiveLabel', { slot: slot.label })}>
          <Archive />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { slot: slot.label })}</DialogTitle>
          <DialogDescription>
            {slot.upcomingVisits > 0
              ? t('archiveBodyVisits', { count: slot.upcomingVisits })
              : t('archiveBody')}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          {slot.upcomingVisits > 0 ? (
            <CustomerNoticeCheckbox
              id={`archive-${slot.id}-notice`}
              error={fieldError(state, 'customerNotified')}
            />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('archive')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Servizi
// -----------------------------------------------------------------------------

export interface CareServiceDefaults {
  readonly presetKey?: string;
  readonly name: string;
  readonly description: string;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
  readonly price: string;
}

/** Nuovo servizio o modifica: incluso nella tariffa, oppure extra con prezzo e unità. */
export function CareServiceDialog({
  action,
  idPrefix,
  currency,
  defaults,
  title,
  trigger,
  submitLabel,
}: {
  readonly action: Action;
  /** Prefisso unico degli ID dei campi (più finestre nella stessa pagina). */
  readonly idPrefix: string;
  readonly currency: string;
  readonly defaults: CareServiceDefaults;
  readonly title: string;
  readonly trigger: ReactNode;
  readonly submitLabel: string;
}) {
  const t = useTranslations('care.services');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [pricing, setPricing] = useState<CareServicePricing>(defaults.pricing);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  const id = idPrefix;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          {defaults.presetKey ? (
            <input type="hidden" name="presetKey" value={defaults.presetKey} />
          ) : null}
          <Field id={`service-${id}-name`} label={t('name')} error={err('name')} required>
            <Input
              {...controlProps(`service-${id}-name`, err('name'))}
              name="name"
              maxLength={CARE_LIMITS.serviceName}
              defaultValue={defaults.name}
              autoComplete="off"
              required
            />
          </Field>
          <Field
            id={`service-${id}-description`}
            label={t('description')}
            hint={t('descriptionHint')}
            error={err('description')}
          >
            <Textarea
              {...controlProps(`service-${id}-description`, err('description'), true)}
              name="description"
              rows={2}
              maxLength={CARE_LIMITS.serviceDescription}
              defaultValue={defaults.description}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('pricing')}</legend>
            {(['INCLUDED', 'EXTRA'] as const).map((value) => (
              <label key={value} className={chip}>
                <input
                  type="radio"
                  name="pricing"
                  value={value}
                  checked={pricing === value}
                  onChange={() => setPricing(value)}
                  className="size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{t(`pricings.${value}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`pricingHints.${value}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {pricing === 'EXTRA' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field
                id={`service-${id}-price`}
                label={t('price', { currency })}
                error={err('price')}
                required
              >
                <Input
                  {...controlProps(`service-${id}-price`, err('price'))}
                  name="price"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={defaults.price}
                  required
                />
              </Field>
              <Field id={`service-${id}-unit`} label={t('unit')} error={err('unit')} required>
                <NativeSelect
                  {...controlProps(`service-${id}-unit`, err('unit'))}
                  name="unit"
                  defaultValue={defaults.unit}
                >
                  {CARE_SERVICE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {t(`units.${unit}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : (
            <input type="hidden" name="unit" value="PER_VISIT" />
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Archiviare o riattivare un servizio: un pulsante solo. */
export function CareServiceToggle({
  action,
  active,
  name,
}: {
  readonly action: Action;
  readonly active: boolean;
  readonly name: string;
}) {
  const t = useTranslations('care.services');
  return (
    <ActionButton
      action={action}
      size="icon-sm"
      variant="ghost"
      aria-label={active ? t('archiveLabel', { name }) : t('restoreLabel', { name })}
      icon={active ? <Archive /> : <RotateCcw />}
    />
  );
}

// -----------------------------------------------------------------------------
// Sovrapprezzo per distanza
// -----------------------------------------------------------------------------

export interface CareTierView {
  readonly id: string;
  readonly distanceLabel: string;
  readonly feeLabel: string;
  readonly removeAction: Action;
}

/** "Hasta X km: $Y por visita". */
export function CareTravelTiersEditor({
  tiers,
  addAction,
  currency,
  readOnly,
}: {
  readonly tiers: readonly CareTierView[];
  readonly addAction: Action;
  readonly currency: string;
  readonly readOnly: boolean;
}) {
  const t = useTranslations('care.tiers');
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(addAction, () => setFormKey((key) => key + 1));
  const err = (field: string) => fieldError(state, field);
  return (
    <div className="grid gap-4">
      {tiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {tiers.map((tier) => (
            <li key={tier.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex flex-wrap gap-x-3">
                <span className="font-medium">{tier.distanceLabel}</span>
                <span className="tabular-nums">{tier.feeLabel}</span>
              </span>
              {readOnly ? null : (
                <ActionButton
                  action={tier.removeAction}
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('remove', { tier: tier.distanceLabel })}
                  icon={<Trash />}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : tiers.length < CARE_LIMITS.travelTiers ? (
        <form
          key={formKey}
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid grid-cols-2 gap-3 sm:grid-cols-[12rem_9rem_auto] sm:items-start"
        >
          <Field id="care-tier-km" label={t('km')} error={err('upToKm')} required>
            <Input
              {...controlProps('care-tier-km', err('upToKm'))}
              name="upToKm"
              type="number"
              inputMode="decimal"
              min={0.1}
              max={100}
              step={0.1}
              required
            />
          </Field>
          <Field id="care-tier-fee" label={t('fee', { currency })} error={err('fee')} required>
            <Input
              {...controlProps('care-tier-fee', err('fee'))}
              name="fee"
              inputMode="decimal"
              autoComplete="off"
              required
            />
          </Field>
          <div className="col-span-2 sm:col-span-1 sm:pt-7">
            <SubmitButton variant="secondary" className="w-full sm:w-auto">
              <Plus />
              {t('add')}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('limit', { max: CARE_LIMITS.travelTiers })}
        </p>
      )}
    </div>
  );
}
