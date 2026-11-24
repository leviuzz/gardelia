import { expect, test } from '@playwright/test';
import { createProduct } from './support/catalog';

/**
 * Interruttore "Tienda en línea" nell'elenco del catalogo (chiesto dal founder il 24/11/2026):
 * si accende e si spegne senza aprire la scheda, la scheda lo rispecchia, lo staff non lo vede.
 */

const SHOP = '/app/las-camelias';
const name = `Tulipán en línea ${Date.now()}`;

test.describe.serial('catalogo: visibile nella tienda en línea', () => {
  test.describe('propietaria', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test("si accende dall'elenco, la scheda lo rispecchia, si spegne", async ({ page }) => {
      await page.goto(`${SHOP}/catalog/new`);
      await createProduct(page, { name, price: '40', colors: ['Rojo'] });

      await page.goto(`${SHOP}/catalog?q=${encodeURIComponent(name)}`);
      const toggle = page.getByRole('switch', { name: `Mostrar ${name} en tu tienda en línea` });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(page.getByText('Ahora se ve en tu tienda en línea.')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');

      // Resta dopo il ricaricamento e la scheda del prodotto dice lo stesso.
      await page.reload();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('link', { name: new RegExp(name) }).click();
      await expect(
        page.getByRole('checkbox', { name: /Mostrar en mi tienda en línea/ }),
      ).toBeChecked();

      await page.goto(`${SHOP}/catalog?q=${encodeURIComponent(name)}`);
      await toggle.click();
      await expect(page.getByText('Ya no aparece en tu tienda en línea.')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  test.describe('staff', () => {
    test.use({ storageState: 'e2e/.auth/staff.json' });

    test("vede il catalogo senza l'interruttore", async ({ page }) => {
      await page.goto(`${SHOP}/catalog`);
      await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeVisible();
      await expect(page.getByRole('switch')).toHaveCount(0);
    });
  });
});
