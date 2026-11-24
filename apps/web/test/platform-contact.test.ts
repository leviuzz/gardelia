import { describe, expect, it } from 'vitest';
import { serverEnvSchema } from '@/lib/env';

/** Variabili minime perché la configurazione del server sia valida. */
const BASE_ENV = {
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://floral_app@localhost/floral',
};

/** WhatsApp della piattaforma per i crediti delle immagini AI (fase di prova, D-29). */
describe('PLATFORM_WHATSAPP', () => {
  it('è facoltativo: vuoto conta come assente', () => {
    expect(serverEnvSchema.parse(BASE_ENV).PLATFORM_WHATSAPP).toBeUndefined();
    expect(
      serverEnvSchema.parse({ ...BASE_ENV, PLATFORM_WHATSAPP: '  ' }).PLATFORM_WHATSAPP,
    ).toBeUndefined();
  });

  it('si incolla com’è: spazi, trattini e parentesi si tolgono', () => {
    expect(
      serverEnvSchema.parse({ ...BASE_ENV, PLATFORM_WHATSAPP: ' +52 (449) 555-0142 ' })
        .PLATFORM_WHATSAPP,
    ).toBe('+524495550142');
  });

  it('senza il prefisso del paese è un errore di configurazione', () => {
    const result = serverEnvSchema.safeParse({ ...BASE_ENV, PLATFORM_WHATSAPP: '449 555 0142' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'PLATFORM_WHATSAPP',
    );
  });
});
