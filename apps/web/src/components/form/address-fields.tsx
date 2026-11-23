'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import {
  AddressSearch,
  usePlacesConfig,
  type FoundAddress,
} from '@/components/form/address-search';
import { Field, controlProps } from '@/components/form/field';
import { Input, NativeSelect } from '@/components/ui/input';

export type AddressFieldName =
  'addressLine1' | 'addressLine2' | 'neighborhood' | 'postalCode' | 'city' | 'region';

/** Colonne: `wide` in una griglia da 6 (impostazioni, onboarding), `compact` in una da 2. */
const SPANS: Record<'wide' | 'compact', Partial<Record<AddressFieldName, string>>> = {
  wide: {
    addressLine1: 'sm:col-span-4',
    addressLine2: 'sm:col-span-2',
    neighborhood: 'sm:col-span-3',
    postalCode: 'sm:col-span-3',
    city: 'sm:col-span-3',
    region: 'sm:col-span-3',
  },
  compact: { addressLine1: 'sm:col-span-2' },
};

/** La ricerca di Google Places occupa tutta la riga. */
const SEARCH_SPAN: Record<'wide' | 'compact', string> = {
  wide: 'sm:col-span-6',
  compact: 'sm:col-span-2',
};

/** Primo mercato (D-02): Aguascalientes, se l'indirizzo non ha ancora uno stato. */
const DEFAULT_REGION = 'AGU';

/**
 * I campi di un indirizzo messicano (calle y número, interior, colonia, CP, municipio, estado),
 * uguali in onboarding, impostazioni della fioreria e indirizzi dei clienti, con
 * l'autocompletamento del browser. I nomi possono avere un prefisso (`location.` nell'onboarding)
 * e gli ID un prefisso quando nella pagina ci sono più form (indirizzi dei clienti).
 */
export function AddressFields({
  regions,
  defaults,
  error,
  layout,
  namePrefix = '',
  idPrefix = '',
}: {
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly defaults?: Partial<Record<AddressFieldName | 'placeId', string | null>>;
  /** Errore per nome completo del campo (`fieldError(state, nome)`). */
  readonly error: (name: string) => string | undefined;
  readonly layout: 'wide' | 'compact';
  readonly namePrefix?: string;
  readonly idPrefix?: string;
}) {
  const t = useTranslations('onboarding');
  const spans = SPANS[layout];
  const name = (field: AddressFieldName) => `${namePrefix}${field}`;
  const id = (field: AddressFieldName) => `${idPrefix}${field}`;
  const err = (field: AddressFieldName) => error(name(field));
  const value = (field: AddressFieldName) => defaults?.[field] ?? undefined;
  const { enabled: placesEnabled } = usePlacesConfig();
  const placeRef = useRef<HTMLInputElement>(null);
  const latitudeRef = useRef<HTMLInputElement>(null);
  const longitudeRef = useRef<HTMLInputElement>(null);

  // Via, numero, municipio o stato cambiati a mano: il punto non è più quello di Google, quindi
  // niente place ID né coordinate. Interno, colonia e CP no: completano l'indirizzo (Google spesso
  // non li dà) senza spostarlo.
  function clearPlace() {
    for (const ref of [placeRef, latitudeRef, longitudeRef]) {
      if (ref.current) ref.current.value = '';
    }
  }

  function fill(found: FoundAddress) {
    const form = placeRef.current?.form;
    if (!form) return;
    const set = (field: AddressFieldName, next: string | null) => {
      const element = form.elements.namedItem(name(field));
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        if (element instanceof HTMLSelectElement) {
          // Solo uno stato che esiste nell'elenco; altrimenti resta quello scelto.
          if (next && [...element.options].some((option) => option.value === next)) {
            element.value = next;
          }
        } else {
          element.value = next ?? '';
        }
      }
    };
    set('addressLine1', found.addressLine1);
    set('addressLine2', found.addressLine2);
    set('neighborhood', found.neighborhood);
    set('postalCode', found.postalCode);
    set('city', found.city);
    set('region', found.region);
    if (placeRef.current) placeRef.current.value = found.placeId;
    if (latitudeRef.current)
      latitudeRef.current.value = found.coordinates?.latitude.toString() ?? '';
    if (longitudeRef.current) {
      longitudeRef.current.value = found.coordinates?.longitude.toString() ?? '';
    }
  }

  return (
    <>
      <input
        type="hidden"
        ref={placeRef}
        name={`${namePrefix}placeId`}
        defaultValue={defaults?.placeId ?? ''}
      />
      <input type="hidden" ref={latitudeRef} name={`${namePrefix}latitude`} defaultValue="" />
      <input type="hidden" ref={longitudeRef} name={`${namePrefix}longitude`} defaultValue="" />
      {placesEnabled ? (
        <div className={SEARCH_SPAN[layout]}>
          <AddressSearch id={`${idPrefix}addressSearch`} onFound={fill} />
        </div>
      ) : null}
      <Field
        id={id('addressLine1')}
        label={t('addressLine1')}
        error={err('addressLine1')}
        required
        className={spans.addressLine1}
      >
        <Input
          {...controlProps(id('addressLine1'), err('addressLine1'))}
          name={name('addressLine1')}
          defaultValue={value('addressLine1')}
          onChange={clearPlace}
          autoComplete="address-line1"
          required
        />
      </Field>
      <Field
        id={id('addressLine2')}
        label={t('addressLine2')}
        error={err('addressLine2')}
        className={spans.addressLine2}
      >
        <Input
          {...controlProps(id('addressLine2'), err('addressLine2'))}
          name={name('addressLine2')}
          defaultValue={value('addressLine2')}
          autoComplete="address-line2"
        />
      </Field>
      <Field
        id={id('neighborhood')}
        label={t('neighborhood')}
        error={err('neighborhood')}
        className={spans.neighborhood}
      >
        <Input
          {...controlProps(id('neighborhood'), err('neighborhood'))}
          name={name('neighborhood')}
          defaultValue={value('neighborhood')}
        />
      </Field>
      <Field
        id={id('postalCode')}
        label={t('postalCode')}
        error={err('postalCode')}
        required
        className={spans.postalCode}
      >
        <Input
          {...controlProps(id('postalCode'), err('postalCode'))}
          name={name('postalCode')}
          defaultValue={value('postalCode')}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          pattern="\d{5}"
          required
        />
      </Field>
      <Field id={id('city')} label={t('city')} error={err('city')} required className={spans.city}>
        <Input
          {...controlProps(id('city'), err('city'))}
          name={name('city')}
          defaultValue={value('city')}
          onChange={clearPlace}
          autoComplete="address-level2"
          required
        />
      </Field>
      <Field
        id={id('region')}
        label={t('region')}
        error={err('region')}
        required
        className={spans.region}
      >
        <NativeSelect
          {...controlProps(id('region'), err('region'))}
          name={name('region')}
          defaultValue={value('region') ?? DEFAULT_REGION}
          onChange={clearPlace}
          required
        >
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}
