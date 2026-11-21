import { describe, expect, it } from 'vitest';
import { authPath } from '@/lib/auth-paths';
import { googleCredentials, serverEnvSchema } from '@/lib/env';
import { oauthErrorKey } from '@/lib/oauth-errors';

/** Variabili minime perché la configurazione del server sia valida. */
const BASE_ENV = {
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://floral_app@localhost/floral',
};

describe('configurazione del login con Google', () => {
  it('è facoltativa: senza chiavi il login con Google resta spento', () => {
    expect(googleCredentials(serverEnvSchema.parse(BASE_ENV))).toBeNull();
  });

  it('le righe vuote del file .env contano come assenti', () => {
    const env = serverEnvSchema.parse({
      ...BASE_ENV,
      GOOGLE_CLIENT_ID: '   ',
      GOOGLE_CLIENT_SECRET: '',
    });
    expect(googleCredentials(env)).toBeNull();
  });

  it('con entrambe le chiavi si attiva (spazi esterni ignorati)', () => {
    const env = serverEnvSchema.parse({
      ...BASE_ENV,
      GOOGLE_CLIENT_ID: ' 123.apps.googleusercontent.com ',
      GOOGLE_CLIENT_SECRET: 'segreto',
    });
    expect(googleCredentials(env)).toEqual({
      clientId: '123.apps.googleusercontent.com',
      clientSecret: 'segreto',
    });
  });

  it.each([
    [{ GOOGLE_CLIENT_ID: '123.apps.googleusercontent.com' }, 'GOOGLE_CLIENT_SECRET'],
    [{ GOOGLE_CLIENT_SECRET: 'segreto' }, 'GOOGLE_CLIENT_ID'],
  ])('una sola chiave è un errore di configurazione (%o)', (partial, missing) => {
    const result = serverEnvSchema.safeParse({ ...BASE_ENV, ...partial });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(missing);
  });
});

describe('errori al ritorno da Google', () => {
  it.each([
    ['access_denied', 'cancelled'],
    ['account_not_linked', 'notLinked'],
    ['email_not_verified', 'emailNotVerified'],
    ['unable_to_create_session', 'sessionFailed'],
    ['state_mismatch', 'generic'],
    ['invalid_code', 'generic'],
  ])('%s → %s', (code, key) => {
    expect(oauthErrorKey(code)).toBe(key);
  });

  it('un codice inventato non entra mai nella pagina: messaggio generico', () => {
    for (const code of ['<script>alert(1)</script>', '__proto__', 'constructor', 'toString']) {
      expect(oauthErrorKey(code)).toBe('generic');
    }
  });

  it('nessun errore se il parametro manca, è vuoto o ripetuto', () => {
    expect(oauthErrorKey(undefined)).toBeNull();
    expect(oauthErrorKey('')).toBeNull();
    expect(oauthErrorKey(['access_denied', 'x'])).toBeNull();
  });
});

describe('percorsi delle pagine di accesso', () => {
  it('omette la destinazione predefinita', () => {
    expect(authPath('/login')).toBe('/login');
    expect(authPath('/login', { next: '/app' })).toBe('/login');
  });

  it('conserva destinazione ed email, codificate', () => {
    expect(authPath('/signup', { next: '/invite/abc', email: 'ana+1@flores.mx' })).toBe(
      '/signup?next=%2Finvite%2Fabc&email=ana%2B1%40flores.mx',
    );
  });
});
