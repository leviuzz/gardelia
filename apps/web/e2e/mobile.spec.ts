import { expect, test } from '@playwright/test';

test.describe('staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('su telefono la navigazione inferiore porta dalla dashboard al catalogo', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias');
    const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
    await expect(bottomNav).toBeVisible();
    // Pedidos e Agenda sono nella barra in basso (ADR-054, ADR-078); il Catálogo nel menu "Más".
    await expect(bottomNav.getByRole('link', { name: 'Pedidos' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Agenda' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Clientes' })).toHaveCount(0);
    // Nel menu "Más" lo staff trova Diseñador e Catálogo, ma non Equipo né Ajustes.
    await bottomNav.getByRole('button', { name: 'Más' }).click();
    await expect(page.getByRole('menuitem', { name: 'Diseñador' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Equipo' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Ajustes' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Catálogo' }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    // Su mobile il catalogo è mostrato a schede, non in tabella. Il prodotto si cerca: l'elenco
    // è paginato e gli altri test aggiungono prodotti.
    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Rosa roja');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/\/catalog\?q=Rosa\+roja(&|$)/);
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
    await expect(page.getByRole('menuitem', { name: 'Calendario' })).toBeVisible();
    // Clientes passa in "Más": al suo posto nella barra c'è l'Agenda (founder, 24/11/2026).
    await expect(page.getByRole('menuitem', { name: 'Clientes' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Equipo' }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);
  });
});
