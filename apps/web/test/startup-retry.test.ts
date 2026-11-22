import { describe, expect, it } from 'vitest';
import { startupRetryDelayMs } from '@/lib/startup-retry';

describe('nuovi tentativi all’avvio se il database non risponde', () => {
  it('attesa crescente: 2 s, 4 s, 8 s…', () => {
    expect([1, 2, 3, 4].map(startupRetryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
  });

  it('mai oltre un minuto, anche dopo molti tentativi', () => {
    expect(startupRetryDelayMs(6)).toBe(60_000);
    expect(startupRetryDelayMs(500)).toBe(60_000);
  });

  it('valori strani restano sensati', () => {
    expect(startupRetryDelayMs(0)).toBe(2_000);
    expect(startupRetryDelayMs(-3)).toBe(2_000);
  });
});
