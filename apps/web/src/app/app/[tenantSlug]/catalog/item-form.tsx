'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  ALLOWED_UNITS_BY_TYPE,
  AVAILABILITY_STATES,
  CATALOG_COLORS,
  CATALOG_ITEM_TYPES,
  DEFAULT_UNIT_BY_TYPE,
  isCanonicalLinkable,
  type Availability,
  type CatalogColor,
  type CatalogItemType,
  type SaleUnit,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { COLOR_SWATCH_CLASS } from '@/lib/catalog-ui';
import { useActionToast } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

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
}

export interface CanonicalOption {
  readonly id: string;
  readonly name: string;
  readonly category: string;
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
};

export function ItemForm({
  mode,
  action,
  canonicalOptions,
  defaults = EMPTY,
}: {
  mode: 'create' | 'edit';
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  canonicalOptions: readonly CanonicalOption[];
  defaults?: ItemFormDefaults;
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(mode === 'edit' ? state : idleState);
  const [type, setType] = useState<CatalogItemType>(defaults.type);
  const [saleUnit, setSaleUnit] = useState<SaleUnit>(defaults.saleUnit);
  const err = (field: string) => fieldError(state, field);

  const units = ALLOWED_UNITS_BY_TYPE[type];
  const linkable = isCanonicalLinkable(type);
  const canonicalForType = canonicalOptions.filter((option) => option.category === type);

  function changeType(next: CatalogItemType) {
    setType(next);
    if (!ALLOWED_UNITS_BY_TYPE[next].includes(saleUnit)) setSaleUnit(DEFAULT_UNIT_BY_TYPE[next]);
  }

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      {mode === 'create' || state.status === 'error' ? <FormAlert state={state} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionBasics')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {mode === 'create' ? (
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
          )}
          <Field id="name" label={t('form.name')} error={err('name')} required>
            <Input
              {...controlProps('name', err('name'))}
              name="name"
              defaultValue={defaults.name}
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
            >
              <NativeSelect
                {...controlProps('canonicalFlowerId', err('canonicalFlowerId'), true)}
                name="canonicalFlowerId"
                defaultValue={defaults.canonicalFlowerId}
                key={type}
              >
                <option value="">{t('form.canonicalNone')}</option>
                {canonicalForType.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <input type="hidden" name="canonicalFlowerId" value="" />
          )}
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
            id="description"
            label={t('form.description')}
            error={err('description')}
            className="sm:col-span-2"
          >
            <Textarea
              {...controlProps('description', err('description'))}
              name="description"
              defaultValue={defaults.description}
              maxLength={2000}
              rows={3}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionPricing')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
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
          <Field
            id="availability"
            label={t('form.availability')}
            error={err('availability')}
            required
          >
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionDetails')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <fieldset className="grid gap-3 sm:col-span-3">
            <legend className="mb-2 text-sm font-medium">{t('form.colors')}</legend>
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
                  <span
                    className={cn(
                      'size-3.5 rounded-full border border-black/10',
                      COLOR_SWATCH_CLASS[color as CatalogColor],
                    )}
                    aria-hidden="true"
                  />
                  {t(`colors.${color}`)}
                </label>
              ))}
            </div>
            {err('colors') ? <p className="text-sm text-destructive">{err('colors')}</p> : null}
          </fieldset>
          <Field
            id="tags"
            label={t('form.tags')}
            hint={t('form.tagsHint')}
            error={err('tags')}
            className="sm:col-span-3"
          >
            <Input
              {...controlProps('tags', err('tags'), true)}
              name="tags"
              defaultValue={defaults.tags}
            />
          </Field>
          <Field id="prepMinutes" label={t('form.prepMinutes')} error={err('prepMinutes')}>
            <Input
              {...controlProps('prepMinutes', err('prepMinutes'))}
              name="prepMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              defaultValue={defaults.prepMinutes}
            />
          </Field>
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <SubmitButton
          size="lg"
          className="w-full sm:w-auto"
          pendingLabel={mode === 'create' ? t('form.creating') : undefined}
        >
          {mode === 'create' ? t('form.create') : t('form.save')}
        </SubmitButton>
      </div>
    </form>
  );
}
