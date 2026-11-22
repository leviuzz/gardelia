import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@floral/core/config';
import { assertConfiguration, configurationIssues } from '@/lib/config-check';

const VALID_WEB = {
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://floral_app@localhost/floral',
};

describe('controllo della configurazione all’avvio', () => {
  it('nessun problema con una configurazione locale valida', () => {
    expect(configurationIssues(VALID_WEB)).toEqual([]);
    expect(() => assertConfiguration(VALID_WEB)).not.toThrow();
  });

  it('unisce i problemi del web e della piattaforma in un solo elenco', () => {
    const issues = configurationIssues({
      APP_URL: 'https://app.floral-os.example',
      DATABASE_URL: 'postgresql://floral_app@db/floral',
      BETTER_AUTH_SECRET: 'corta',
      GOOGLE_CLIENT_ID: 'solo-id',
      AI_PROVIDER: 'fal',
    });
    const names = issues.map((issue) => issue.split(':')[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        'BETTER_AUTH_SECRET',
        'GOOGLE_CLIENT_SECRET',
        'FAL_KEY',
        'STORAGE_DRIVER',
      ]),
    );
    expect(issues.join('\n')).not.toContain('corta');
  });

  it('se qualcosa non va l’app non parte ed elenca tutto', () => {
    let thrown: unknown;
    try {
      assertConfiguration({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    const message = (thrown as ConfigurationError).message;
    expect(message).toContain('APP_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('DATABASE_URL');
  });
});
