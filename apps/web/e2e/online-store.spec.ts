import { expect, test } from '@playwright/test';

/**
 * "Mi tienda en línea" (marketplace, blocco C2, ADR-065): la proprietaria mostra un ramo,
 * completa la tienda e la pubblica; chi compra la apre senza account e scrive su WhatsApp; ritirata,
 * la pagina non esiste più.
 */
test.describe('tienda en línea (propietaria y cliente)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('se publica, se ve sin cuenta y se retira', async ({ page, browser }) => {
    // Idempotente: se un giro precedente l'ha lasciata pubblicata, si ritira prima.
    await page.goto('/app/las-camelias/settings/store');
    await expect(page.getByRole('heading', { level: 1, name: 'Tienda en línea' })).toBeVisible();
    const unpublish = page.getByRole('button', { name: 'Retirar mi tienda' });
    if ((await unpublish.count()) > 0) {
      await unpublish.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Retirar mi tienda' }).click();
      await expect(page.getByText('Tu tienda ya no es visible.')).toBeVisible();
    }

    // Il ramo si mostra in linea dalla sua scheda del catalogo.
    await page.goto('/app/las-camelias/catalog?q=Ramo+Cl%C3%A1sico');
    await page
      .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
      .first()
      .click();
    const online = page.getByRole('checkbox', { name: /Mostrar en mi tienda en línea/ });
    await online.check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();

    // Presentazione e forme di pagamento.
    await page.goto('/app/las-camelias/settings');
    await page.getByRole('link', { name: /Tienda en línea/ }).click();
    await page.getByLabel('Presentación').fill('Flores frescas en el centro de Aguascalientes.');
    await page.getByRole('checkbox', { name: 'Transferencia' }).check();
    await page.getByRole('checkbox', { name: 'Efectivo' }).check();
    await page.getByLabel('Datos para pagar').fill('CLABE 012345678901234567 (BBVA)');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Tienda actualizada.')).toBeVisible();

    await page.getByRole('button', { name: 'Publicar mi tienda' }).click();
    await expect(page.getByText('Tu tienda está publicada.')).toBeVisible();
    await expect(page.getByText('Publicada', { exact: true })).toBeVisible();
    const url = await page.getByRole('textbox', { name: 'Enlace de tu tienda' }).inputValue();
    expect(url).toMatch(/\/f\/las-camelias$/);

    // Chi compra, senza account.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const shopper = await visitor.newPage();
    await shopper.goto('/f/las-camelias');
    await expect(
      shopper.getByRole('heading', { level: 1, name: 'Florería Las Camelias' }),
    ).toBeVisible();
    await expect(shopper.getByText('Flores frescas en el centro de Aguascalientes.')).toBeVisible();
    await expect(shopper.getByText('Florería de demostración')).toBeVisible();
    await expect(shopper.getByText('CLABE 012345678901234567 (BBVA)')).toBeVisible();
    // Solo i prodotti mostrati in linea (le rose sciolte del catalogo no).
    await expect(shopper.getByRole('link', { name: /^Rosa roja/ })).toHaveCount(0);
    await shopper.getByRole('link', { name: /Ramo Clásico 12 rosas/ }).click();
    await expect(
      shopper.getByRole('heading', { level: 1, name: 'Ramo Clásico 12 rosas' }),
    ).toBeVisible();
    await expect(shopper.getByText('$690.00')).toBeVisible();
    await expect(shopper.getByRole('link', { name: 'Pedir por WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/52\d{10}\?text=/,
    );

    // Ritirata, la pagina non esiste più.
    await page.getByRole('button', { name: 'Retirar mi tienda' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retirar mi tienda' }).click();
    await expect(page.getByText('Tu tienda ya no es visible.')).toBeVisible();
    await shopper.goto('/f/las-camelias');
    await expect(
      shopper.getByRole('heading', { name: 'Esta tienda no está disponible' }),
    ).toBeVisible();
    await visitor.close();
  });
});
