import { expect, test } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/owner.json' });

test.describe('catalogo (proprietario)', () => {
  test('valida, crea, modifica e archivia un articolo', async ({ page }) => {
    const name = `Hortensia azul ${Date.now()}`;
    await page.goto('/app/las-camelias/catalog/new');

    // Validazione lato server: prezzo non valido.
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await page.getByLabel('Precio de venta (MXN)').fill('12,345.00');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Escribe un importe válido')).toBeVisible();

    await page.getByLabel('Precio de venta (MXN)').fill('95');
    await page.getByText('Azul', { exact: true }).click();
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Producto creado')).toBeVisible();

    await page.getByLabel('Precio de venta (MXN)').fill('99.90');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();

    await page.getByRole('button', { name: 'Archivar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByText('Este producto está archivado.')).toBeVisible();

    await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent(name)}&status=ARCHIVED`);
    await expect(page.getByRole('table').getByText('$99.90')).toBeVisible();
  });

  test('la receta di un ramo ricalcola costi e margini', async ({ page }) => {
    const bouquet = `Ramo E2E ${Date.now()}`;
    await page.goto('/app/las-camelias/catalog/new');
    await page.getByLabel('Tipo de producto').selectOption('BOUQUET');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(bouquet);
    await page.getByLabel('Precio de venta (MXN)').fill('500');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Este ramo aún no tiene ingredientes.')).toBeVisible();

    // 10 rose rosse a 14.00 di costo = 140.00
    await page
      .getByLabel('Ingrediente', { exact: true })
      .selectOption({ label: 'Rosa roja · Freedom' });
    await page.getByLabel('Cantidad', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Agregar ingrediente' }).click();
    await expect(page.getByText('Ingrediente agregado')).toBeVisible();

    const costing = page.locator('dl').filter({ hasText: 'Costo de materiales' });
    await expect(costing.getByText('$140.00')).toBeVisible();
    await expect(costing.getByText('$360.00 · 72%')).toBeVisible();
  });
});

test.describe('isolamento', () => {
  test('lo slug di un’altra fioreria risponde 404', async ({ page }) => {
    const response = await page.goto('/app/flores-del-valle/catalog');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Página no encontrada')).toBeVisible();
  });
});
