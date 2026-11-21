import { expect, test } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/staff.json' });

test('su telefono la navigazione inferiore porta dalla dashboard al catalogo', async ({ page }) => {
  await page.goto('/app/las-camelias');
  const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
  await expect(bottomNav).toBeVisible();
  await bottomNav.getByRole('link', { name: 'Catálogo' }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  // Su mobile il catalogo è mostrato a schede, non in tabella.
  await expect(page.getByRole('table')).toBeHidden();
  await expect(page.getByRole('link', { name: /Rosa roja/ }).first()).toBeVisible();
});
