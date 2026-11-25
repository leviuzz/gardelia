'use client';

import { CalendarRange, CircleStop, Pencil, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  CARE_LIMITS,
  PLANT_LIGHT_LEVELS,
  PLANT_SIZES,
  type CareFrequency,
  type CareServicePricing,
  type CareServiceUnit,
  type PlantLight,
  type PlantSize,
} from '@floral/domain';
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

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

export interface CareSlotOption {
  readonly id: string;
  readonly weekday: number;
  /** "Martes · 09:00–12:00" già formattato. */
  readonly label: string;
}

export interface CareServiceOption {
  readonly serviceId: string;
  readonly name: string;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
  readonly priceMinor: number;
}

function ServicePrice({
  service,
  currency,
}: {
  readonly service: CareServiceOption;
  readonly currency: string;
}) {
  const t = useTranslations('care.services');
  return (
    <span className="text-xs text-muted-foreground">
      {service.pricing === 'INCLUDED'
        ? t('included')
        : t(`priceBy.${service.unit}`, { price: money(service.priceMinor, currency) })}
    </span>
  );
}

/** Frequenza e fasce: una fascia per le mensili, da 1 a 3 giorni diversi per la settimanale. */
function ScheduleFields({
  idPrefix,
  frequencies,
  slots,
  defaults,
  state,
}: {
  readonly idPrefix: string;
  readonly frequencies: readonly CareFrequency[];
  readonly slots: readonly CareSlotOption[];
  readonly defaults: { readonly frequency: CareFrequency; readonly slotIds: readonly string[] };
  readonly state: ActionState;
}) {
  const t = useTranslations('care.contractForm');
  const to = useTranslations('care.offer');
  const [frequency, setFrequency] = useState<CareFrequency>(defaults.frequency);
  const err = (field: string) => fieldError(state, field);
  const weekly = frequency === 'WEEKLY';
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">
          {t('frequency')}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </legend>
        {frequencies.map((value) => (
          <label key={value} className={choice}>
            <input
              type="radio"
              name="frequency"
              value={value}
              checked={frequency === value}
              onChange={() => setFrequency(value)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{to(`frequencyNames.${value}`)}</span>
              <span className="block text-xs text-muted-foreground">
                {to(`frequencyHints.${value}`)}
              </span>
            </span>
          </label>
        ))}
        {err('frequency') ? <p className="text-sm text-destructive">{err('frequency')}</p> : null}
      </fieldset>
      <fieldset className="grid gap-2" key={weekly ? 'weekly' : 'monthly'}>
        <legend className="text-sm font-medium">
          {weekly ? t('slotsWeekly') : t('slotMonthly')}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </legend>
        <p className="-mt-1 text-xs text-muted-foreground">
          {weekly ? t('slotsWeeklyHint') : t('slotMonthlyHint')}
        </p>
        {slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noSlots')}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => (
              <label key={slot.id} className={choice}>
                {weekly ? (
                  <Checkbox
                    name="slotIds"
                    value={slot.id}
                    defaultChecked={defaults.slotIds.includes(slot.id)}
                    className="mt-0.5"
                  />
                ) : (
                  <input
                    type="radio"
                    name="slotIds"
                    value={slot.id}
                    defaultChecked={defaults.slotIds.includes(slot.id)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                )}
                <span className="font-medium">{slot.label}</span>
              </label>
            ))}
          </div>
        )}
        {err('slotIds') ? (
          <p id={`${idPrefix}-slots-error`} className="text-sm text-destructive">
            {err('slotIds')}
          </p>
        ) : null}
      </fieldset>
    </>
  );
}

export interface CareContractFormDefaults {
  readonly customerAddressId: string;
  readonly frequency: CareFrequency;
  readonly slotIds: readonly string[];
  readonly startDate: string;
  readonly seats: string;
  readonly serviceIds: readonly string[];
  readonly contactName: string;
  readonly contactPhone: string;
  /** «Usa i dati del cliente» acceso all'apertura. */
  readonly useCustomerContact: boolean;
  readonly accessNotes: string;
  readonly notes: string;
  readonly outOfRangeConfirmed: boolean;
}

/** Persona e telefono della sede presi dal cliente, già pronti da mostrare nei campi. */
export interface CareSiteContact {
  readonly name: string;
  /** Formato per l'input; vuoto se il cliente non ha telefono. */
  readonly phone: string;
}

/**
 * Persona di contatto e telefono della sede, con «Usa i dati del cliente»: accesa, i campi prendono
 * i dati del cliente (o del destinatario dell'indirizzo) e non si scrivono; spenta, si scrivono a
 * mano partendo da quello che c'era. Un campo senza dato del cliente resta sempre scrivibile.
 * I campi sono `readOnly`, non `disabled`, così arrivano nel modulo come sempre.
 */
function SiteContactFields({
  idPrefix,
  contact,
  defaults,
  defaultOn,
  errors,
}: {
  readonly idPrefix: string;
  readonly contact: CareSiteContact;
  readonly defaults: { readonly contactName: string; readonly contactPhone: string };
  readonly defaultOn: boolean;
  readonly errors: { readonly name?: string; readonly phone?: string };
}) {
  const t = useTranslations('care.contractForm');
  const [on, setOn] = useState(defaultOn);
  const [name, setName] = useState(defaultOn ? contact.name : defaults.contactName);
  const [phone, setPhone] = useState(
    defaultOn && contact.phone ? contact.phone : defaults.contactPhone,
  );
  const lockName = on && contact.name !== '';
  const lockPhone = on && contact.phone !== '';
  const shownName = lockName ? contact.name : name;
  const shownPhone = lockPhone ? contact.phone : phone;
  const toggle = (next: boolean) => {
    // Spegnendo si parte da quello che si vedeva.
    if (!next) {
      setName(shownName);
      setPhone(shownPhone);
    }
    setOn(next);
  };
  return (
    <div className="grid gap-3">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <Checkbox
          checked={on}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-0.5"
          data-testid="use-customer-contact"
        />
        <span>
          <span className="block font-medium">{t('useCustomerContact')}</span>
          <span className="block text-xs text-muted-foreground">{t('useCustomerContactHint')}</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-contact`} label={t('contactName')} error={errors.name}>
          <Input
            {...controlProps(`${idPrefix}-contact`, errors.name)}
            name="contactName"
            maxLength={CARE_LIMITS.contactName}
            autoComplete="off"
            value={shownName}
            readOnly={lockName}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          id={`${idPrefix}-phone`}
          label={t('contactPhone')}
          hint={on && contact.phone === '' ? t('noCustomerPhone') : undefined}
          error={errors.phone}
        >
          <Input
            {...controlProps(`${idPrefix}-phone`, errors.phone)}
            name="contactPhone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={shownPhone}
            readOnly={lockPhone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Nuovo contratto o modifica della bozza: sede, frequenza e fasce, primo giorno, servizi e dati
 * pratici della sede. Il prezzo non si scrive: lo calcola il server dalle piante, alla conferma.
 */
export function CareContractForm({
  action,
  currency,
  addresses,
  frequencies,
  slots,
  services,
  start,
  defaults,
  submitLabel,
}: {
  readonly action: Action;
  readonly currency: string;
  readonly addresses: readonly {
    readonly id: string;
    readonly label: string;
    readonly line: string;
    /** Persona e telefono del cliente per questa sede («Usa i dati del cliente»). */
    readonly contact: CareSiteContact;
  }[];
  readonly frequencies: readonly CareFrequency[];
  readonly slots: readonly CareSlotOption[];
  readonly services: readonly CareServiceOption[];
  readonly start: { readonly min: string; readonly max: string };
  readonly defaults: CareContractFormDefaults;
  readonly submitLabel: string;
}) {
  const t = useTranslations('care.contractForm');
  const [state, formAction] = useToastActionState(action);
  const [addressId, setAddressId] = useState(defaults.customerAddressId);
  const err = (field: string) => fieldError(state, field);
  const outOfRange = defaults.outOfRangeConfirmed || Boolean(err('outOfRangeConfirmed'));
  const contact = addresses.find((address) => address.id === addressId)?.contact ?? {
    name: '',
    phone: '',
  };
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      <section className="grid gap-4 rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">{t('siteTitle')}</h2>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            {t('address')}
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          </legend>
          {addresses.map((address) => (
            <label key={address.id} className={choice}>
              <input
                type="radio"
                name="customerAddressId"
                value={address.id}
                defaultChecked={defaults.customerAddressId === address.id}
                onChange={() => setAddressId(address.id)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{address.label}</span>
                <span className="block text-xs text-muted-foreground">{address.line}</span>
              </span>
            </label>
          ))}
          {err('customerAddressId') ? (
            <p className="text-sm text-destructive">{err('customerAddressId')}</p>
          ) : null}
        </fieldset>
        {outOfRange ? (
          <div className="grid gap-1.5 rounded-xl border bg-warning-soft/60 p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
              <Checkbox
                name="outOfRangeConfirmed"
                value="on"
                defaultChecked={defaults.outOfRangeConfirmed}
                className="mt-0.5"
              />
              <span>{t('outOfRange')}</span>
            </label>
            {err('outOfRangeConfirmed') ? (
              <p className="pl-7 text-sm text-destructive">{err('outOfRangeConfirmed')}</p>
            ) : null}
          </div>
        ) : null}
        <SiteContactFields
          idPrefix="contract"
          contact={contact}
          defaults={defaults}
          defaultOn={defaults.useCustomerContact}
          errors={{ name: err('contactName'), phone: err('contactPhone') }}
        />
        <Field
          id="contract-access"
          label={t('accessNotes')}
          hint={t('accessNotesHint')}
          error={err('accessNotes')}
        >
          <Textarea
            {...controlProps('contract-access', err('accessNotes'), true)}
            name="accessNotes"
            rows={2}
            maxLength={CARE_LIMITS.siteNotes}
            defaultValue={defaults.accessNotes}
          />
        </Field>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">{t('scheduleTitle')}</h2>
        <ScheduleFields
          idPrefix="contract"
          frequencies={frequencies}
          slots={slots}
          defaults={defaults}
          state={state}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="contract-start"
            label={t('startDate')}
            error={err('startDate')}
            hint={t('startDateHint')}
            required
          >
            <Input
              {...controlProps('contract-start', err('startDate'), true)}
              type="date"
              name="startDate"
              min={start.min}
              max={start.max}
              defaultValue={defaults.startDate}
              required
            />
          </Field>
          <Field id="contract-seats" label={t('seats')} hint={t('seatsHint')} error={err('seats')}>
            <Input
              {...controlProps('contract-seats', err('seats'), true)}
              type="number"
              name="seats"
              inputMode="numeric"
              min={1}
              max={CARE_LIMITS.visitSeats}
              defaultValue={defaults.seats}
              placeholder="1"
            />
          </Field>
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border bg-card p-4">
        <div>
          <h2 className="font-semibold">{t('servicesTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('servicesHint')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((service) => (
            <label key={service.serviceId} className={choice}>
              <Checkbox
                name="serviceIds"
                value={service.serviceId}
                defaultChecked={defaults.serviceIds.includes(service.serviceId)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{service.name}</span>
                <ServicePrice service={service} currency={currency} />
              </span>
            </label>
          ))}
        </div>
        {err('serviceIds') ? <p className="text-sm text-destructive">{err('serviceIds')}</p> : null}
        <Field id="contract-notes" label={t('notes')} hint={t('notesHint')} error={err('notes')}>
          <Textarea
            {...controlProps('contract-notes', err('notes'), true)}
            name="notes"
            rows={2}
            maxLength={CARE_LIMITS.notes}
            defaultValue={defaults.notes}
          />
        </Field>
      </section>

      <div className="flex justify-end">
        <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Piante
// -----------------------------------------------------------------------------

export interface CarePlantDefaults {
  readonly name: string;
  readonly speciesId: string;
  readonly quantity: string;
  readonly size: PlantSize;
  readonly location: string;
  readonly light: PlantLight | '';
  readonly watering: string;
  readonly instructions: string;
  /** Pianta del cambio di stagione (ADR-078). */
  readonly seasonal: boolean;
}

/** Una riga di piante della diagnosi, anche un gruppo ("12 potos en jardinera"). */
export function CarePlantDialog({
  action,
  idPrefix,
  species,
  defaults,
  title,
  trigger,
  submitLabel,
}: {
  readonly action: Action;
  readonly idPrefix: string;
  readonly species: readonly { readonly id: string; readonly name: string }[];
  readonly defaults: CarePlantDefaults;
  readonly title: string;
  readonly trigger: ReactNode;
  readonly submitLabel: string;
}) {
  const t = useTranslations('care.plants');
  const to = useTranslations('care.offer');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <Field id={id('name')} label={t('name')} error={err('name')} required>
              <Input
                {...controlProps(id('name'), err('name'))}
                name="name"
                maxLength={CARE_LIMITS.plantName}
                defaultValue={defaults.name}
                placeholder={t('namePlaceholder')}
                autoComplete="off"
                required
              />
            </Field>
            <Field id={id('quantity')} label={t('quantity')} error={err('quantity')} required>
              <Input
                {...controlProps(id('quantity'), err('quantity'))}
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={CARE_LIMITS.plantQuantity}
                defaultValue={defaults.quantity}
                required
              />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('size')}</legend>
            <div className="grid grid-cols-3 gap-2">
              {PLANT_SIZES.map((size) => (
                <label key={size} className={choice}>
                  <input
                    type="radio"
                    name="size"
                    value={size}
                    defaultChecked={defaults.size === size}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  {to(`sizes.${size}`)}
                </label>
              ))}
            </div>
            {err('size') ? <p className="text-sm text-destructive">{err('size')}</p> : null}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={id('species')}
              label={t('species')}
              hint={t('speciesHint')}
              error={err('canonicalFlowerId')}
            >
              <NativeSelect
                {...controlProps(id('species'), err('canonicalFlowerId'), true)}
                name="canonicalFlowerId"
                defaultValue={defaults.speciesId}
              >
                <option value="">{t('noSpecies')}</option>
                {species.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={id('light')} label={t('light')} error={err('light')}>
              <NativeSelect
                {...controlProps(id('light'), err('light'))}
                name="light"
                defaultValue={defaults.light}
              >
                <option value="">{t('lightUnknown')}</option>
                {PLANT_LIGHT_LEVELS.map((light) => (
                  <option key={light} value={light}>
                    {t(`lights.${light}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id={id('location')} label={t('location')} error={err('location')}>
            <Input
              {...controlProps(id('location'), err('location'))}
              name="location"
              maxLength={CARE_LIMITS.plantLocation}
              defaultValue={defaults.location}
              placeholder={t('locationPlaceholder')}
              autoComplete="off"
            />
          </Field>
          <Field id={id('watering')} label={t('watering')} error={err('watering')}>
            <Input
              {...controlProps(id('watering'), err('watering'))}
              name="watering"
              maxLength={CARE_LIMITS.plantText}
              defaultValue={defaults.watering}
              autoComplete="off"
            />
          </Field>
          <Field
            id={id('instructions')}
            label={t('instructions')}
            hint={t('instructionsHint')}
            error={err('instructions')}
          >
            <Textarea
              {...controlProps(id('instructions'), err('instructions'), true)}
              name="instructions"
              rows={2}
              maxLength={CARE_LIMITS.plantText}
              defaultValue={defaults.instructions}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <Checkbox
              name="seasonal"
              value="on"
              defaultChecked={defaults.seasonal}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{t('seasonal')}</span>
              <span className="block text-xs text-muted-foreground">{t('seasonalHint')}</span>
            </span>
          </label>
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

// -----------------------------------------------------------------------------
// Contratto attivo: calendario, dati, prezzo, fine
// -----------------------------------------------------------------------------

/** Nuova frequenza o nuove fasce "a partir de": le visite da quel giorno si rifanno. */
export function CareScheduleDialog({
  action,
  frequencies,
  slots,
  defaults,
  start,
  upcomingVisits,
}: {
  readonly action: Action;
  readonly frequencies: readonly CareFrequency[];
  readonly slots: readonly CareSlotOption[];
  readonly defaults: {
    readonly frequency: CareFrequency;
    readonly slotIds: readonly string[];
    readonly seats: string;
    readonly startDate: string;
  };
  readonly start: { readonly min: string; readonly max: string };
  readonly upcomingVisits: number;
}) {
  const t = useTranslations('care.scheduleDialog');
  const tf = useTranslations('care.contractForm');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <CalendarRange />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <ScheduleFields
            idPrefix="schedule"
            frequencies={frequencies}
            slots={slots}
            defaults={defaults}
            state={state}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field id="schedule-from" label={t('from')} error={err('startDate')} required>
              <Input
                {...controlProps('schedule-from', err('startDate'))}
                type="date"
                name="startDate"
                min={start.min}
                max={start.max}
                defaultValue={defaults.startDate}
                required
              />
            </Field>
            <Field id="schedule-seats" label={tf('seats')} error={err('seats')}>
              <Input
                {...controlProps('schedule-seats', err('seats'))}
                type="number"
                name="seats"
                inputMode="numeric"
                min={1}
                max={CARE_LIMITS.visitSeats}
                defaultValue={defaults.seats}
              />
            </Field>
          </div>
          {upcomingVisits > 0 ? (
            <CustomerNoticeCheckbox
              id="schedule-notice"
              error={err('customerNotified')}
              hint={t('notice', { count: upcomingVisits })}
            />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Servizi e dati pratici di un contratto confermato (nessuna visita cambia). */
export function CareDetailsDialog({
  action,
  currency,
  services,
  contact,
  defaults,
}: {
  readonly action: Action;
  readonly currency: string;
  readonly services: readonly CareServiceOption[];
  /** Persona e telefono del cliente per la sede del contratto («Usa i dati del cliente»). */
  readonly contact: CareSiteContact;
  readonly defaults: {
    readonly serviceIds: readonly string[];
    readonly contactName: string;
    readonly contactPhone: string;
    readonly useCustomerContact: boolean;
    readonly accessNotes: string;
    readonly notes: string;
  };
}) {
  const t = useTranslations('care.contractForm');
  const td = useTranslations('care.detailsDialog');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Pencil />
          {td('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{td('title')}</DialogTitle>
          <DialogDescription>{td('body')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('servicesTitle')}</legend>
            {services.map((service) => (
              <label key={service.serviceId} className={choice}>
                <Checkbox
                  name="serviceIds"
                  value={service.serviceId}
                  defaultChecked={defaults.serviceIds.includes(service.serviceId)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">{service.name}</span>
                  <ServicePrice service={service} currency={currency} />
                </span>
              </label>
            ))}
            {err('serviceIds') ? (
              <p className="text-sm text-destructive">{err('serviceIds')}</p>
            ) : null}
          </fieldset>
          <SiteContactFields
            idPrefix="details"
            contact={contact}
            defaults={defaults}
            defaultOn={defaults.useCustomerContact}
            errors={{ name: err('contactName'), phone: err('contactPhone') }}
          />
          <Field id="details-access" label={t('accessNotes')} error={err('accessNotes')}>
            <Textarea
              {...controlProps('details-access', err('accessNotes'))}
              name="accessNotes"
              rows={2}
              maxLength={CARE_LIMITS.siteNotes}
              defaultValue={defaults.accessNotes}
            />
          </Field>
          <Field id="details-notes" label={t('notes')} error={err('notes')}>
            <Textarea
              {...controlProps('details-notes', err('notes'))}
              name="notes"
              rows={2}
              maxLength={CARE_LIMITS.notes}
              defaultValue={defaults.notes}
            />
          </Field>
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

/** Aggiorna il prezzo salvato con piante, servizi e tariffe di oggi: cambia quanto paga il cliente. */
export function CareRepriceDialog({
  action,
  from,
  to,
}: {
  readonly action: Action;
  /** Prezzi per visita già formattati. */
  readonly from: string;
  readonly to: string;
}) {
  const t = useTranslations('care.repriceDialog');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RefreshCw />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body', { from, to })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          <CustomerNoticeCheckbox
            id="reprice-notice"
            error={fieldError(state, 'customerNotified')}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ultimo giorno di servizio: le visite dopo si cancellano. */
export function CareEndDialog({
  action,
  range,
  upcomingVisits,
}: {
  readonly action: Action;
  readonly range: { readonly min: string; readonly max: string; readonly suggested: string };
  readonly upcomingVisits: number;
}) {
  const t = useTranslations('care.endDialog');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full text-muted-foreground sm:ml-auto sm:w-auto">
          <CircleStop />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field id="end-date" label={t('lastDay')} error={err('endDate')} required>
            <Input
              {...controlProps('end-date', err('endDate'))}
              type="date"
              name="endDate"
              min={range.min}
              max={range.max}
              defaultValue={range.suggested}
              required
            />
          </Field>
          {upcomingVisits > 0 ? (
            <CustomerNoticeCheckbox
              id="end-notice"
              error={err('customerNotified')}
              hint={t('notice', { count: upcomingVisits })}
            />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('submit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
