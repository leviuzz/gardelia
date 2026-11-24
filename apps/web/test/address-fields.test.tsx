// @vitest-environment happy-dom
import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressFields } from '@/components/form/address-fields';
import { PlacesConfigProvider } from '@/components/form/address-search';

// I testi arrivano dal provider dell'app: qui basta la chiave.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

/**
 * Il punto di Google scelto dai suggerimenti deve arrivare al server. Visto il 24/11 su staging:
 * React riscriveva i campi nascosti a ogni nuovo disegno del form e il punto spariva prima
 * dell'invio (tienda mai sulla mappa, costo per distanza perso nel pedido). Google è simulato.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REGIONS = [{ code: 'AGU', name: 'Aguascalientes' }];
/** Una colonia: Google non dà la via. */
const COLONIA = {
  placeId: 'ChIJ_colonia_rsm',
  addressLine1: '',
  addressLine2: null,
  neighborhood: 'Rancho Santa Monica',
  postalCode: '20286',
  city: 'Aguascalientes',
  region: 'AGU',
  coordinates: { latitude: 21.918, longitude: -102.324 },
};

/** Form con uno stato del genitore che cambia: un nuovo disegno come in un form vero. */
function Harness() {
  const [renders, setRenders] = useState(0);
  return (
    <PlacesConfigProvider enabled near={null}>
      <form>
        <AddressFields
          regions={REGIONS}
          error={() => undefined}
          layout="wide"
          mapStatus={{ onMap: false, onMapText: 'on-map', offMapText: 'off-map' }}
        />
        <button type="button" data-testid="rerender" onClick={() => setRenders(renders + 1)}>
          {renders}
        </button>
      </form>
    </PlacesConfigProvider>
  );
}

let container: HTMLDivElement;
let root: Root;
/** Testo del suggerimento che Google propone (e che la persona sceglie). */
let suggestionText = 'Rancho Santa Monica';

beforeEach(() => {
  suggestionText = 'Rancho Santa Monica';
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/autocomplete')
        ? {
            suggestions: [
              { placeId: COLONIA.placeId, mainText: suggestionText, secondaryText: null },
            ],
          }
        : { details: COLONIA };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const input = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const hidden = () => ({
  placeId: input('placeId').value,
  latitude: input('latitude').value,
  longitude: input('longitude').value,
});
const status = () => container.querySelector('[data-testid="map-status"]')?.textContent;

/** Scrive in un campo come la tastiera (React ascolta l'evento `input`). */
async function type(element: HTMLInputElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseColonia() {
  const search = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await type(search, 'rancho santa');
  // Pausa della scrittura prima di chiedere i suggerimenti.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  const option = container.querySelector('[role="option"]')!;
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

describe('AddressFields: punto di Google', () => {
  it('resta nei campi nascosti dopo un nuovo disegno del form', async () => {
    act(() => root.render(<Harness />));
    expect(status()).toBe('off-map');
    await chooseColonia();
    expect(hidden()).toEqual({
      placeId: COLONIA.placeId,
      latitude: '21.918',
      longitude: '-102.324',
    });
    expect(status()).toBe('on-map');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rerender"]')!.click();
    });
    expect(hidden().placeId).toBe(COLONIA.placeId);
    expect(hidden().latitude).toBe('21.918');
  });

  it('la via che Google non ha dato si scrive senza perdere il punto; il municipio no', async () => {
    act(() => root.render(<Harness />));
    await chooseColonia();
    await type(input('addressLine1'), 'Magnolias 3');
    expect(hidden().placeId).toBe(COLONIA.placeId);
    expect(status()).toBe('on-map');

    await type(input('city'), 'Jesús María');
    expect(hidden()).toEqual({ placeId: '', latitude: '', longitude: '' });
    expect(status()).toBe('off-map');
  });

  it('Google senza via: si usa quella del suggerimento scelto, se ha il numero civico', async () => {
    suggestionText = 'Magnolias 59';
    act(() => root.render(<Harness />));
    await chooseColonia();
    expect(input('addressLine1').value).toBe('Magnolias 59');
    expect(hidden().placeId).toBe(COLONIA.placeId);
    expect(status()).toBe('on-map');
  });

  it('una colonia senza via: il campo resta vuoto e il cursore ci va', async () => {
    act(() => root.render(<Harness />));
    await chooseColonia();
    expect(input('addressLine1').value).toBe('');
    expect(document.activeElement).toBe(input('addressLine1'));
  });
});
