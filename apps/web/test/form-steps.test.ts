import { describe, expect, it } from 'vitest';
import { firstStepWithError } from '@/lib/form-steps';

/** Moduli a passi (ADR-044): un errore del server riporta al primo passo che lo contiene. */
describe('firstStepWithError', () => {
  const stepOf = (name: string) => (name.startsWith('location.') ? 1 : 0);

  it('sceglie il primo passo con un errore', () => {
    expect(firstStepWithError({ 'location.postalCode': 'x' }, stepOf)).toBe(1);
    expect(firstStepWithError({ 'location.city': 'x', displayName: 'required' }, stepOf)).toBe(0);
  });

  it("senza errori per campo resta dov'è", () => {
    expect(firstStepWithError(undefined, stepOf)).toBeNull();
    expect(firstStepWithError({}, stepOf)).toBeNull();
  });
});
