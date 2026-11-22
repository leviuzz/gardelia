import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  isLocalAppUrl,
  readPlatformConfig,
  type EnvSource,
} from '../src/config';
import { aiMonthlyBudgetMicros } from '../src/ai/providers';
import { createMailerFromEnv, ConsoleMailer, SmtpMailer } from '../src/mailer';

const PUBLIC = { APP_URL: 'https://app.floral-os.example' };
const R2 = {
  STORAGE_DRIVER: 'r2',
  R2_ACCOUNT_ID: 'acc',
  R2_BUCKET: 'bucket',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret',
};

function issuesOf(env: EnvSource): readonly string[] {
  try {
    readPlatformConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues;
    throw error;
  }
}

describe('configurazione della piattaforma', () => {
  it('in locale bastano i valori predefiniti', () => {
    expect(readPlatformConfig({})).toMatchObject({
      AI_PROVIDER: 'none',
      STORAGE_DRIVER: 'filesystem',
      AI_MONTHLY_BUDGET_USD: 50,
    });
  });

  it('produzione completa: fal, R2 e SMTP', () => {
    const config = readPlatformConfig({
      ...PUBLIC,
      ...R2,
      NODE_ENV: 'production',
      SMTP_URL: 'smtp://mail.example:587',
      AI_PROVIDER: 'fal',
      FAL_KEY: ' chiave ',
      AI_MONTHLY_BUDGET_USD: '120',
    });
    expect(config.FAL_KEY).toBe('chiave');
    expect(config.AI_MONTHLY_BUDGET_USD).toBe(120);
  });

  it('elenca TUTTI i problemi insieme, con il nome della variabile e mai il valore', () => {
    const issues = issuesOf({
      ...PUBLIC,
      NODE_ENV: 'production',
      AI_PROVIDER: 'fal',
      STORAGE_DRIVER: 'r2',
      R2_BUCKET: 'bucket',
      AI_MONTHLY_BUDGET_USD: 'molto',
    });
    const names = issues.map((issue) => issue.split(':')[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        'FAL_KEY',
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'SMTP_URL',
        'AI_MONTHLY_BUDGET_USD',
      ]),
    );
    expect(names).not.toContain('R2_BUCKET');
    expect(issues.join('\n')).not.toContain('molto');
  });

  it('gli adattatori locali (simulato, file) solo con un APP_URL locale', () => {
    expect(issuesOf({ ...PUBLIC, ...R2, AI_PROVIDER: 'simulated' })).toEqual([
      expect.stringMatching(/^AI_PROVIDER: .*solo in locale/),
    ]);
    expect(issuesOf({ ...PUBLIC, STORAGE_DRIVER: 'filesystem' })).toEqual([
      expect.stringMatching(/^STORAGE_DRIVER: .*solo in locale/),
    ]);
    expect(issuesOf({ APP_URL: 'http://localhost:3000', AI_PROVIDER: 'simulated' })).toEqual([]);
  });

  it('valori sconosciuti e righe vuote', () => {
    expect(issuesOf({ AI_PROVIDER: 'openai' })[0]).toMatch(/^AI_PROVIDER: /);
    expect(issuesOf({ STORAGE_DRIVER: 's3' })[0]).toMatch(/^STORAGE_DRIVER: /);
    expect(issuesOf({ AI_MONTHLY_BUDGET_USD: '-5' })[0]).toMatch(/^AI_MONTHLY_BUDGET_USD: /);
    // `X=` nel file .env conta come assente: si usa il predefinito.
    expect(readPlatformConfig({ AI_MONTHLY_BUDGET_USD: ' ' }).AI_MONTHLY_BUDGET_USD).toBe(50);
    expect(aiMonthlyBudgetMicros({ AI_MONTHLY_BUDGET_USD: '12.5' })).toBe(12_500_000);
  });

  it('email: SMTP se c’è, altrimenti nel log (ma non in produzione)', () => {
    expect(createMailerFromEnv({ SMTP_URL: 'smtp://localhost:1025' })).toBeInstanceOf(SmtpMailer);
    expect(createMailerFromEnv({})).toBeInstanceOf(ConsoleMailer);
    expect(() => createMailerFromEnv({ NODE_ENV: 'production' })).toThrow(/SMTP_URL/);
  });

  it('riconosce gli URL locali', () => {
    expect(isLocalAppUrl(undefined)).toBe(true);
    expect(isLocalAppUrl('http://127.0.0.1:3100')).toBe(true);
    expect(isLocalAppUrl('https://app.floral-os.example')).toBe(false);
    expect(isLocalAppUrl('non è un url')).toBe(false);
  });
});
