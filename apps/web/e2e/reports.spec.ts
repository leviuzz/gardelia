import { expect, test } from '@playwright/test';

/**
 * Reportes (ADR-080): chi gestisce vede il mese, passa al mese prima e all'anno; lo staff no. I
 * numeri sono provati nei test d'integrazione (`packages/core/test/reports.test.ts`).
 */

test.describe('reportes (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il mese di oggi, il mese prima e l’anno', async ({ page }) => {
    await page.goto('/app/las-camelias');
    await page.getByRole('link', { name: 'Reportes' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reportes' })).toBeVisible();
    const kpis = page.getByTestId('report-kpis');
    for (const label of ['Ventas', 'Pedidos entregados', 'Ticket promedio', 'Cobrado']) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('report-margin')).toBeVisible();
    await expect(page.getByTestId('report-upcoming')).toBeVisible();
    // Floral Care con i cargos e i pagamenti veri (ADR-082), non più la stima.
    const care = page.getByTestId('report-care');
    await expect(care.getByText('Floral Care', { exact: true })).toBeVisible();
    await expect(care.getByRole('link', { name: 'Ver Cobros' })).toBeVisible();

    await page.getByRole('link', { name: /^Periodo anterior/ }).click();
    await expect(page).toHaveURL(/\/reports\?mes=\d{4}-\d{2}$/);
    await expect(page.getByRole('link', { name: 'Periodo siguiente' })).toBeVisible();

    await page.getByRole('link', { name: 'Año', exact: true }).click();
    await expect(page).toHaveURL(/\/reports\?ano=\d{4}$/);
    await expect(page.getByRole('heading', { level: 2, name: /^\d{4}$/ })).toBeVisible();
  });
});

test.describe('reportes (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff non vede i reportes', async ({ page }) => {
    await page.goto('/app/las-camelias/reports');
    await expect(page.getByRole('heading', { name: 'Sin acceso a esta sección' })).toBeVisible();
    await expect(page.getByTestId('report-kpis')).toHaveCount(0);
  });
});
