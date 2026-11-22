import { describe, expect, it } from 'vitest';
import { unshownFieldErrors } from '@/lib/use-action-toast';

describe('errori per campo che la pagina non mostra', () => {
  it('nessuno se ogni messaggio è visibile accanto al suo campo', () => {
    const page = 'Correo electrónico\nEste campo es obligatorio.\nContraseña';
    expect(unshownFieldErrors({ email: 'Este campo es obligatorio.' }, page)).toEqual([]);
  });

  it('il campo non è nel form (valore nascosto o pulsante): il messaggio va mostrato', () => {
    const page = 'Elige un cliente\nHotel Casa Fuentes';
    expect(unshownFieldErrors({ customerId: 'Este campo es obligatorio.' }, page)).toEqual([
      'Este campo es obligatorio.',
    ]);
  });

  it('solo quelli mancanti, senza ripetere lo stesso messaggio', () => {
    const page = 'Nombre\nEste campo es obligatorio.';
    expect(
      unshownFieldErrors(
        {
          name: 'Este campo es obligatorio.',
          laborCost: 'Escribe un importe válido.',
          other: 'Escribe un importe válido.',
        },
        page,
      ),
    ).toEqual(['Escribe un importe válido.']);
  });
});
