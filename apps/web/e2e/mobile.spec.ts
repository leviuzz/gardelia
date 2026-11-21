import { expect, test } from '@playwright/test';

test.describe('staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('su telefono la navigazione inferiore porta dalla dashboard al catalogo', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias');
    const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(bottomNav).toBeVisible();
    // Lo staff non ha sezioni secondarie: nessun menu "Más".
    await expect(bottomNav.getByRole('button', { name: 'Más' })).toBeHidden();
    await bottomNav.getByRole('link', { name: 'Catálogo' }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    // Su mobile il catalogo è mostrato a schede, non in tabella.
    await expect(page.getByRole('table')).toBeHidden();
    await expect(page.getByRole('link', { name: /Rosa roja/ }).first()).toBeVisible();
  });
});

test.describe('propietario', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('le sezioni secondarie sono nel menu "Más"', async ({ page }) => {
    await page.goto('/app/las-camelias');
    const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(bottomNav.getByRole('link', { name: 'Cotizaciones' })).toBeVisible();
    await bottomNav.getByRole('button', { name: 'Más' }).click();
    await page.getByRole('menuitem', { name: 'Equipo' }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);
  });
});
