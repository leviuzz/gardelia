'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useActionState,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ALLOWED_UNITS_BY_TYPE,
  AVAILABILITY_STATES,
  CATALOG_COLORS,
  CATALOG_ITEM_TYPES,
  CATALOG_LIMITS,
  DEFAULT_UNIT_BY_TYPE,
  SERVICE_DURATION_OPTIONS,
  allowsPhotos,
  canShowOnline,
  hasSupplier,
  isBuilderComponentType,
  isCanonicalLinkable,
  isServiceType,
  suggestSpecies,
  type Availability,
  type CatalogItemType,
  type SaleUnit,
  type SpeciesOption,
} from '@floral/domain';
import { ColorSwatch } from '@/components/common/color-swatch';
import { StepIndicator } from '@/components/common/step-indicator';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { formatDuration } from '@/lib/duration';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';
import { SpeciesField } from './species-field';

export interface ItemFormDefaults {
  readonly type: CatalogItemType;
  readonly name: string;
  readonly variety: string;
  readonly canonicalFlowerId: string;
  readonly sku: string;
  readonly description: string;
  readonly saleUnit: SaleUnit;
  readonly price: string;
  readonly cost: string;
  readonly availability: Availability;
  readonly colors: readonly string[];
  readonly tags: string;
  readonly prepMinutes: string;
  readonly heightCm: string;
  readonly widthCm: string;
  /** Proveedor habitual (ADR-081). */
  readonly supplierId: string;
  /** Servizi (ADR-081): durata in minuti e raggio in km. */
  readonly serviceDurationMinutes: string;
  readonly serviceRadiusKm: string;
  readonly isBuilderEnabled: boolean;
  /** "Mostrar en mi tienda en línea" (ADR-065). */
  readonly isOnline: boolean;
}

/** Specie della tassonomia pronta per la ricerca (ADR-043). */
export type CanonicalOption = SpeciesOption;

/**
 * Proveedores tra cui scegliere quello abituale (ADR-081); null = il campo non c'è (senza il piano
 * dell'inventario o senza i permessi): il valore salvato resta com'è.
 */
export interface SupplierChoices {
  readonly options: readonly { readonly id: string; readonly name: string }[];
  /** Pagina dei proveedores, per chi non ne ha ancora. */
  readonly manageHref: string;
}

const EMPTY: ItemFormDefaults = {
  type: 'CUT_FLOWER',
  name: '',
  variety: '',
  canonicalFlowerId: '',
  sku: '',
  description: '',
  saleUnit: 'STEM',
  price: '',
  cost: '',
  availability: 'AVAILABLE',
  colors: [],
  tags: '',
  prepMinutes: '',
  heightCm: '',
  widthCm: '',
  supplierId: '',
  serviceDurationMinutes: '',
  serviceRadiusKm: '',
  isBuilderEnabled: true,
  isOnline: false,
};

/** Campi di ogni passo della creazione guidata: un errore del server riporta al suo passo. */
const STEP_FIELDS: readonly (readonly string[])[] = [
  ['type', 'name', 'variety', 'canonicalFlowerId'],
  ['colors'],
  [
    'saleUnit',
    'availability',
    'price',
    'cost',
    'serviceDurationMinutes',
    'serviceRadiusKm',
    'isOnline',
    'supplierId',
    'sku',
    'description',
    'tags',
    'isBuilderEnabled',
    'prepMinutes',
    'heightCm',
    'widthCm',
  ],
];
const LAST_FORM_STEP = STEP_FIELDS.length - 1;
/** Campi facoltativi raccolti in "Más detalles" (aperto se uno ha un errore). */
const MORE_FIELDS = [
  'supplierId',
  'sku',
  'description',
  'tags',
  'isBuilderEnabled',
  'prepMinutes',
  'heightCm',
  'widthCm',
];

function errorFields(state: ActionState): readonly string[] {
  return state.status === 'error' && state.fieldErrors ? Object.keys(state.fieldErrors) : [];
}

/**
 * Prodotto del catalogo. In creazione è una procedura guidata (cosa è, colori, prezzo; poi foto
 * e "listo" in `new/[itemId]`): un solo <form> con i passi nascosti, così il server riceve tutto
 * insieme e un errore riporta al passo giusto senza perdere nulla. In modifica gli stessi gruppi
 * di campi stanno uno sotto l'altro.
 */
export function ItemForm({
  mode,
  action,
  canonicalOptions,
  suppliers = null,
  defaults = EMPTY,
}: {
  mode: 'create' | 'edit';
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  canonicalOptions: readonly CanonicalOption[];
  suppliers?: SupplierChoices | null;
  defaults?: ItemFormDefaults;
}) {
  const t = useTranslations('catalog');
  const ts = useTranslations('steps');
  const tDuration = useTranslations('duration');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(mode === 'edit' ? state : idleState);
  const [type, setType] = useState<CatalogItemType>(defaults.type);
  const [saleUnit, setSaleUnit] = useState<SaleUnit>(defaults.saleUnit);
  const [productName, setProductName] = useState(defaults.name);
  const err = (field: string) => fieldError(state, field);

  const wizard = mode === 'create';
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const stepWhat = useRef<HTMLElement>(null);
  const stepColors = useRef<HTMLElement>(null);
  const stepPrice = useRef<HTMLElement>(null);
  const stepRefs = [stepWhat, stepColors, stepPrice];

  // Errore dal server: si torna al primo passo con un campo sbagliato (aprendo i dettagli).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const fields = errorFields(state);
    const target = STEP_FIELDS.findIndex((stepFields) =>
      stepFields.some((field) => fields.includes(field)),
    );
    if (target >= 0) setStep(target);
    if (fields.some((field) => MORE_FIELDS.includes(field))) setMoreOpen(true);
  }

  const units = ALLOWED_UNITS_BY_TYPE[type];
  const linkable = isCanonicalLinkable(type);
  const canonicalForType = useMemo(
    () => canonicalOptions.filter((option) => option.category === type),
    [canonicalOptions, type],
  );
  // Specie riconosciuta dal nome del prodotto ("Rosa roja" → Rosa): vale finché non si sceglie.
  const suggestion = useMemo(
    () => suggestSpecies(productName, canonicalForType),
    [productName, canonicalForType],
  );

  const wizardSteps = [
    { key: 'what', label: t('wizard.stepWhat') },
    { key: 'colors', label: t('wizard.stepColors') },
    { key: 'price', label: t('wizard.stepPrice') },
    ...(allowsPhotos(type) ? [{ key: 'photo', label: t('wizard.stepPhoto') }] : []),
    { key: 'done', label: t('wizard.stepDone') },
  ];

  function changeType(next: CatalogItemType) {
    setType(next);
    if (!ALLOWED_UNITS_BY_TYPE[next].includes(saleUnit)) setSaleUnit(DEFAULT_UNIT_BY_TYPE[next]);
  }

  /** Primo campo non valido di un passo (anche se il passo è nascosto). */
  function firstInvalid(index: number): HTMLInputElement | null {
    const fields =
      stepRefs[index]?.current?.querySelectorAll<HTMLInputElement>('input, select, textarea');
    for (const field of fields ?? []) if (!field.checkValidity()) return field;
    return null;
  }

  function goTo(index: number) {
    flushSync(() => {
      setStep(index);
      setReached((current) => Math.max(current, index));
    });
    document.getElementById(`item-step-${index}`)?.focus();
  }

  /** Mostra l'errore del browser sul campo, aprendo prima passo e dettagli se sono chiusi. */
  function report(index: number, field: HTMLInputElement) {
    flushSync(() => {
      setStep(index);
      if (field.closest('details')) setMoreOpen(true);
    });
    field.reportValidity();
  }

  /** Avanti fino al passo `target`, controllando i passi che si lasciano. */
  function advanceTo(target: number) {
    for (let index = step; index < target; index++) {
      const invalid = firstInvalid(index);
      if (invalid) {
        report(index, invalid);
        return;
      }
    }
    goTo(target);
  }

  function next() {
    advanceTo(step + 1);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (wizard) {
      // Invio da tastiera nei primi passi: vale "Continuar".
      if (step < LAST_FORM_STEP) {
        event.preventDefault();
        next();
        return;
      }
      for (let index = 0; index <= LAST_FORM_STEP; index++) {
        const invalid = firstInvalid(index);
        if (invalid) {
          event.preventDefault();
          report(index, invalid);
          return;
        }
      }
    }
    preserveOnSubmit(formAction)(event);
  }

  const typeField =
    mode === 'create' ? (
      <Field
        id="type"
        label={t('form.type')}
        error={err('type')}
        required
        className="sm:col-span-2"
      >
        <NativeSelect
          {...controlProps('type', err('type'))}
          name="type"
          value={type}
          onChange={(event) => changeType(event.target.value as CatalogItemType)}
        >
          {CATALOG_ITEM_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`types.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    ) : (
      <div className="grid gap-2 sm:col-span-2">
        <input type="hidden" name="type" value={type} />
        <span className="text-sm font-medium">{t('form.type')}</span>
        <p className="text-sm">
          {t(`types.${type}`)}{' '}
          <span className="text-muted-foreground">· {t('form.typeLocked')}</span>
        </p>
      </div>
    );

  const basicsFields = (
    <>
      {typeField}
      <Field id="name" label={t('form.name')} error={err('name')} required>
        <Input
          {...controlProps('name', err('name'))}
          name="name"
          defaultValue={defaults.name}
          onChange={(event) => setProductName(event.target.value)}
          placeholder={t('form.namePlaceholder')}
          maxLength={120}
          required
        />
      </Field>
      <Field id="variety" label={t('form.variety')} error={err('variety')}>
        <Input
          {...controlProps('variety', err('variety'))}
          name="variety"
          defaultValue={defaults.variety}
          placeholder={t('form.varietyPlaceholder')}
          maxLength={80}
        />
      </Field>
      {linkable ? (
        <Field
          id="canonicalFlowerId"
          label={t('form.canonical')}
          hint={t('form.canonicalHint')}
          error={err('canonicalFlowerId')}
          className="sm:col-span-2"
        >
          <SpeciesField
            key={type}
            id="canonicalFlowerId"
            options={canonicalForType}
            defaultValue={defaults.canonicalFlowerId}
            suggestion={suggestion}
            describedBy={
              controlProps('canonicalFlowerId', err('canonicalFlowerId'), true)['aria-describedby']
            }
            invalid={Boolean(err('canonicalFlowerId'))}
          />
        </Field>
      ) : (
        <input type="hidden" name="canonicalFlowerId" value="" />
      )}
    </>
  );

  const colorsField = (
    <fieldset className="grid gap-3">
      <legend className="sr-only">{t('form.colors')}</legend>
      <div className="flex flex-wrap gap-2">
        {CATALOG_COLORS.map((color) => (
          <label
            key={color}
            className="flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30"
          >
            <input
              type="checkbox"
              name="colors"
              value={color}
              defaultChecked={defaults.colors.includes(color)}
              className="sr-only"
            />
            <ColorSwatch color={color} />
            {t(`colors.${color}`)}
          </label>
        ))}
      </div>
      {err('colors') ? <p className="text-sm text-destructive">{err('colors')}</p> : null}
    </fieldset>
  );

  const pricingFields = (
    <>
      <Field id="saleUnit" label={t('form.saleUnit')} error={err('saleUnit')} required>
        <NativeSelect
          {...controlProps('saleUnit', err('saleUnit'))}
          name="saleUnit"
          value={saleUnit}
          onChange={(event) => setSaleUnit(event.target.value as SaleUnit)}
        >
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {t(`unitsLong.${unit}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="availability" label={t('form.availability')} error={err('availability')} required>
        <NativeSelect
          {...controlProps('availability', err('availability'))}
          name="availability"
          defaultValue={defaults.availability}
        >
          {AVAILABILITY_STATES.map((value) => (
            <option key={value} value={value}>
              {t(`availability.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="price"
        label={t('form.price')}
        hint={t('form.priceHint')}
        error={err('price')}
        required
      >
        <Input
          {...controlProps('price', err('price'), true)}
          name="price"
          defaultValue={defaults.price}
          inputMode="decimal"
          placeholder="0.00"
          required
        />
      </Field>
      <Field id="cost" label={t('form.cost')} hint={t('form.costHint')} error={err('cost')}>
        <Input
          {...controlProps('cost', err('cost'), true)}
          name="cost"
          defaultValue={defaults.cost}
          inputMode="decimal"
          placeholder="0.00"
        />
      </Field>
      {/* Servizi (ADR-081): durata e fin dove si fanno, al posto del tempo di preparazione. */}
      {isServiceType(type) ? (
        <>
          <Field
            id="serviceDurationMinutes"
            label={t('form.serviceDuration')}
            hint={t('form.serviceDurationHint')}
            error={err('serviceDurationMinutes')}
          >
            <NativeSelect
              {...controlProps('serviceDurationMinutes', err('serviceDurationMinutes'), true)}
              name="serviceDurationMinutes"
              defaultValue={defaults.serviceDurationMinutes}
            >
              <option value="">{t('form.serviceDurationNone')}</option>
              {serviceDurationChoices(defaults.serviceDurationMinutes).map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatDuration((key, values) => tDuration(key, values), minutes)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="serviceRadiusKm"
            label={t('form.serviceRadius')}
            hint={t('form.serviceRadiusHint')}
            error={err('serviceRadiusKm')}
          >
            <Input
              {...controlProps('serviceRadiusKm', err('serviceRadiusKm'), true)}
              name="serviceRadiusKm"
              type="number"
              inputMode="numeric"
              min={1}
              max={CATALOG_LIMITS.serviceRadiusKmMax}
              defaultValue={defaults.serviceRadiusKm}
            />
          </Field>
        </>
      ) : null}
      {/* Pagina pubblica della fioreria (ADR-065): solo ramos, piante, fiori e accessori. */}
      {canShowOnline(type) ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 sm:col-span-2">
          <Checkbox name="isOnline" defaultChecked={defaults.isOnline} className="mt-0.5" />
          <span className="text-sm">
            <span className="block font-medium">{t('form.online')}</span>
            <span className="block text-muted-foreground">{t('form.onlineHint')}</span>
          </span>
        </label>
      ) : null}
    </>
  );

  const moreFields = (
    <div className="grid gap-5 sm:grid-cols-3">
      {/* Proveedor habitual (ADR-081): solo con l'inventario, dove i proveedores esistono. */}
      {suppliers && hasSupplier(type) ? (
        suppliers.options.length > 0 ? (
          <Field
            id="supplierId"
            label={t('form.supplier')}
            hint={t('form.supplierHint')}
            error={err('supplierId')}
            className="sm:col-span-3"
          >
            <NativeSelect
              {...controlProps('supplierId', err('supplierId'), true)}
              name="supplierId"
              defaultValue={defaults.supplierId}
            >
              <option value="">{t('form.supplierNone')}</option>
              {suppliers.options.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          // Nessun proveedor ancora: si dice dove aggiungerli (il valore salvato, se c'è, resta).
          <div className="grid gap-1 text-sm sm:col-span-3">
            <span className="font-medium">{t('form.supplier')}</span>
            <p className="text-muted-foreground">
              {t('form.supplierEmpty')}{' '}
              <Link href={suppliers.manageHref} className="font-medium text-primary underline">
                {t('form.supplierAdd')}
              </Link>
            </p>
          </div>
        )
      ) : null}
      <Field id="sku" label={t('form.sku')} error={err('sku')}>
        <Input
          {...controlProps('sku', err('sku'))}
          name="sku"
          defaultValue={defaults.sku}
          maxLength={40}
          autoCapitalize="characters"
        />
      </Field>
      <Field
        id="tags"
        label={t('form.tags')}
        hint={t('form.tagsHint')}
        error={err('tags')}
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('tags', err('tags'), true)}
          name="tags"
          defaultValue={defaults.tags}
        />
      </Field>
      <Field
        id="description"
        label={t('form.description')}
        error={err('description')}
        className="sm:col-span-3"
      >
        <Textarea
          {...controlProps('description', err('description'))}
          name="description"
          defaultValue={defaults.description}
          maxLength={2000}
          rows={3}
        />
      </Field>
      {isBuilderComponentType(type) ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 sm:col-span-3">
          <Checkbox
            name="isBuilderEnabled"
            defaultChecked={defaults.isBuilderEnabled}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="block font-medium">{t('form.builderEnabled')}</span>
            <span className="block text-muted-foreground">{t('form.builderEnabledHint')}</span>
          </span>
        </label>
      ) : null}
      {isServiceType(type) ? null : (
        <Field
          id="prepMinutes"
          label={t('form.prepMinutes')}
          hint={t('form.prepMinutesHint')}
          error={err('prepMinutes')}
        >
          <Input
            {...controlProps('prepMinutes', err('prepMinutes'), true)}
            name="prepMinutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            defaultValue={defaults.prepMinutes}
          />
        </Field>
      )}
      <Field id="heightCm" label={t('form.heightCm')} error={err('heightCm')}>
        <Input
          {...controlProps('heightCm', err('heightCm'))}
          name="heightCm"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          defaultValue={defaults.heightCm}
        />
      </Field>
      <Field id="widthCm" label={t('form.widthCm')} error={err('widthCm')}>
        <Input
          {...controlProps('widthCm', err('widthCm'))}
          name="widthCm"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          defaultValue={defaults.widthCm}
        />
      </Field>
    </div>
  );

  if (!wizard) {
    return (
      <form action={formAction} onSubmit={onSubmit} className="space-y-6">
        {state.status === 'error' ? <FormAlert state={state} /> : null}
        <Section title={t('form.sectionBasics')}>
          <div className="grid gap-5 sm:grid-cols-2">{basicsFields}</div>
        </Section>
        <Section title={t('form.colors')}>{colorsField}</Section>
        <Section title={t('form.sectionPricing')}>
          <div className="grid gap-5 sm:grid-cols-2">{pricingFields}</div>
        </Section>
        <Section title={t('form.sectionDetails')}>{moreFields}</Section>
        <div className="flex justify-end">
          <SubmitButton size="lg" className="w-full sm:w-auto">
            {t('form.save')}
          </SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="space-y-6">
      <StepIndicator
        steps={wizardSteps}
        current={step}
        reachable={reached}
        onSelect={(index) => (index < step ? goTo(index) : advanceTo(index))}
      />
      <FormAlert state={state} />

      <WizardStep
        index={0}
        current={step}
        sectionRef={stepWhat}
        title={t('wizard.whatTitle')}
        description={t('wizard.whatBody')}
      >
        <div className="grid gap-5 sm:grid-cols-2">{basicsFields}</div>
      </WizardStep>
      <WizardStep
        index={1}
        current={step}
        sectionRef={stepColors}
        title={t('wizard.colorsTitle')}
        description={t('wizard.colorsBody')}
      >
        {colorsField}
      </WizardStep>
      <WizardStep
        index={2}
        current={step}
        sectionRef={stepPrice}
        title={t('wizard.priceTitle')}
        description={t('wizard.priceBody')}
      >
        <div className="grid gap-5 sm:grid-cols-2">{pricingFields}</div>
        <details
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          className="group mt-6 rounded-xl border"
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none marker:hidden">
            <span className="flex items-center justify-between gap-3">
              {t('wizard.moreDetails')}
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="border-t p-4">{moreFields}</div>
        </details>
      </WizardStep>

      {/* Su telefono uno sotto l'altro, l'azione principale sopra. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {step > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => goTo(step - 1)}
          >
            <ArrowLeft aria-hidden="true" />
            {ts('back')}
          </Button>
        ) : null}
        <div className="sm:ml-auto">
          {step < LAST_FORM_STEP ? (
            <Button type="button" size="lg" className="w-full sm:w-auto" onClick={next}>
              {ts('continue')}
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel={t('form.creating')}>
              {t('form.create')}
            </SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}

/** Le durate della tendina, più quella salvata se non è tra le proposte (non si perde). */
function serviceDurationChoices(saved: string): readonly number[] {
  const current = Number(saved);
  const options: number[] = [...SERVICE_DURATION_OPTIONS];
  if (Number.isInteger(current) && current > 0 && !options.includes(current)) {
    options.push(current);
    options.sort((a, b) => a - b);
  }
  return options;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Un passo della creazione guidata: resta nel DOM (i campi partono col modulo) ma nascosto. */
function WizardStep({
  index,
  current,
  sectionRef,
  title,
  description,
  children,
}: {
  index: number;
  current: number;
  sectionRef: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section ref={sectionRef} hidden={index !== current} aria-labelledby={`item-step-${index}`}>
      <Card>
        <CardHeader>
          <CardTitle
            id={`item-step-${index}`}
            tabIndex={-1}
            className="font-display text-xl font-semibold outline-none"
          >
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}
