'use client';

import { MapPinCheck, MapPinOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { streetFromSuggestion } from '@floral/domain';
import {
  AddressSearch,
  usePlacesConfig,
  type FoundAddress,
} from '@/components/form/address-search';
import { Field, controlProps } from '@/components/form/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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

/** Punto di Google nei campi nascosti del form (stringhe vuote = nessun punto). */
interface StoredPlaceFields {
  readonly placeId: string;
  readonly latitude: string;
  readonly longitude: string;
}

const NO_PLACE: StoredPlaceFields = { placeId: '', latitude: '', longitude: '' };

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
  mapStatus,
}: {
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly defaults?: Partial<Record<AddressFieldName | 'placeId', string | null>>;
  /** Errore per nome completo del campo (`fieldError(state, nome)`). */
  readonly error: (name: string) => string | undefined;
  readonly layout: 'wide' | 'compact';
  readonly namePrefix?: string;
  readonly idPrefix?: string;
  /**
   * Dice sotto la ricerca se l'indirizzo ha la posizione di Google (solo dove conta: la sede della
   * fioreria, che chi compra trova cercando il proprio indirizzo). Cambia mentre si scrive.
   */
  readonly mapStatus?: {
    readonly onMap: boolean;
    readonly onMapText: string;
    readonly offMapText: string;
  };
}) {
  const t = useTranslations('onboarding');
  const spans = SPANS[layout];
  const name = (field: AddressFieldName) => `${namePrefix}${field}`;
  const id = (field: AddressFieldName) => `${idPrefix}${field}`;
  const err = (field: AddressFieldName) => error(name(field));
  const value = (field: AddressFieldName) => defaults?.[field] ?? undefined;
  const { enabled: placesEnabled } = usePlacesConfig();
  const placeRef = useRef<HTMLInputElement>(null);
  // Punto di Google in stato React, non scritto a mano nei campi nascosti: React riscrive il
  // `defaultValue` di un input nascosto a ogni nuovo disegno (per gli input nascosti valore e valore
  // predefinito coincidono), e il punto appena scelto sparirebbe prima dell'invio (visto il 24/11).
  const [place, setPlace] = useState<StoredPlaceFields>(() => ({
    placeId: defaults?.placeId ?? '',
    latitude: '',
    longitude: '',
  }));
  const [onMap, setOnMap] = useState(mapStatus?.onMap ?? false);
  // Google ha trovato una zona senza via (una colonia, un fraccionamiento): la via si completa a
  // mano dentro quella zona, quindi scriverla non sposta il punto. Vale finché non si cerca altro.
  const streetToComplete = useRef(false);

  // Via, numero, municipio o stato cambiati a mano: il punto non è più quello di Google, quindi
  // niente place ID né coordinate. Interno, colonia e CP no: completano l'indirizzo (Google spesso
  // non li dà) senza spostarlo. Nemmeno la via, se Google non l'aveva data (vedi sotto).
  function clearPlace() {
    setPlace((current) => (current.placeId === '' && current.latitude === '' ? current : NO_PLACE));
    setOnMap(false);
    streetToComplete.current = false;
  }

  /** La via scritta a mano toglie il punto di Google, tranne quando Google non l'aveva data. */
  function onStreetChange() {
    if (!streetToComplete.current) clearPlace();
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
    // Google a volte non dà la via: vale quella del suggerimento scelto, se ha un numero civico.
    const googleStreet = found.addressLine1.trim();
    const street = googleStreet || streetFromSuggestion(found.label, found);
    set('addressLine1', street);
    streetToComplete.current = googleStreet === '';
    set('addressLine2', found.addressLine2);
    set('neighborhood', found.neighborhood);
    set('postalCode', found.postalCode);
    set('city', found.city);
    set('region', found.region);
    setPlace({
      placeId: found.placeId,
      latitude: found.coordinates?.latitude.toString() ?? '',
      longitude: found.coordinates?.longitude.toString() ?? '',
    });
    setOnMap(found.coordinates !== null);
    // Via ancora da scrivere (una colonia): il cursore ci va da solo.
    if (street === '') {
      const element = form.elements.namedItem(name('addressLine1'));
      if (element instanceof HTMLInputElement) element.focus();
    }
  }

  return (
    <>
      <input type="hidden" ref={placeRef} name={`${namePrefix}placeId`} value={place.placeId} />
      <input type="hidden" name={`${namePrefix}latitude`} value={place.latitude} />
      <input type="hidden" name={`${namePrefix}longitude`} value={place.longitude} />
      {placesEnabled ? (
        <div className={SEARCH_SPAN[layout]}>
          <AddressSearch id={`${idPrefix}addressSearch`} onFound={fill} />
          {mapStatus ? (
            <p
              data-testid="map-status"
              aria-live="polite"
              className={cn(
                'mt-3 flex items-start gap-2 rounded-xl p-3 text-sm',
                onMap ? 'bg-success-soft' : 'bg-warning-soft text-[oklch(0.38_0.09_65)]',
              )}
            >
              {onMap ? (
                <MapPinCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <span>{onMap ? mapStatus.onMapText : mapStatus.offMapText}</span>
            </p>
          ) : null}
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
          onChange={onStreetChange}
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
