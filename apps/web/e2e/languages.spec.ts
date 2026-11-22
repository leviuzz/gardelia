import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Lingue dell'interfaccia (ADR-042): spagnolo predefinito, italiano e inglese scelti da ogni
 * persona. I testi attesi vengono dai file delle traduzioni, così il test controlla il
 * collegamento (cookie → messaggi → pagina) e non una traduzione in particolare.
 */
type Messages = { readonly [key: string]: string | Messages };

function messages(locale: string): Messages {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Messages;
}

function text(all: Messages, path: string): string {
  const value = path
    .split('.')
    .reduce<string | Messages | undefined>(
      (node, key) => (typeof node === 'object' ? node[key] : undefined),
      all,
    );
  if (typeof value !== 'string') throw new Error(`Testo mancante: ${path}`);
  return value;
}

const es = messages('es-MX');
const it = messages('it-IT');
const en = messages('en-US');

test.describe('lingua dalla pagina di accesso', () => {
  test('si passa all’italiano e si torna allo spagnolo; la scelta resta', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
    await expect(page.getByRole('heading', { name: text(es, 'auth.loginTitle') })).toBeVisible();

    await page.getByRole('button', { name: 'Italiano' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it-IT');
    await expect(page.getByRole('heading', { name: text(it, 'auth.loginTitle') })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Italiano' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // La scelta vale anche per le altre pagine dello stesso browser.
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: text(it, 'auth.signupTitle') })).toBeVisible();

    await page.getByRole('button', { name: 'Español' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
    await expect(page.getByRole('heading', { name: text(es, 'auth.signupTitle') })).toBeVisible();
  });

  test('un valore di lingua sconosciuto nel cookie torna allo spagnolo', async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'xx-XX', url: baseURL ?? '' }]);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  });
});

test.describe('lingua dal menu dell’account', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('la fioreria si usa in inglese e poi di nuovo in spagnolo', async ({ page }) => {
    await page.goto('/app/las-camelias');
    const nav = page
      .getByRole('navigation', { name: text(es, 'nav.mainNavigation') })
      .filter({ visible: true })
      .first();
    await expect(nav.getByRole('link', { name: text(es, 'nav.catalog') })).toBeVisible();

    await page
      .getByRole('button', { name: text(es, 'nav.account') })
      .filter({ visible: true })
      .click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    const navEn = page
      .getByRole('navigation', { name: text(en, 'nav.mainNavigation') })
      .filter({ visible: true })
      .first();
    await expect(navEn.getByRole('link', { name: text(en, 'nav.catalog') })).toBeVisible();

    await page
      .getByRole('button', { name: text(en, 'nav.account') })
      .filter({ visible: true })
      .click();
    await page.getByRole('menuitem', { name: 'Español' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
    await expect(nav.getByRole('link', { name: text(es, 'nav.catalog') })).toBeVisible();
  });
});
