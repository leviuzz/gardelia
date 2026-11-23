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

    // Logo e copertina (stessa catena delle foto del catalogo).
    await page.getByLabel('Archivo del logo').setInputFiles('e2e/fixtures/ramo.jpg');
    await page.getByRole('button', { name: /^(Subir|Cambiar) logo$/ }).click();
    await expect(page.getByText('Se subió 1 foto')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quitar logo' })).toBeVisible();
    await page.getByLabel('Archivo de la portada').setInputFiles('e2e/fixtures/rosa.jpg');
    await page.getByRole('button', { name: /^(Subir|Cambiar) portada$/ }).click();
    await expect(page.getByRole('button', { name: 'Quitar portada' })).toBeVisible();

    await page.getByRole('button', { name: 'Publicar mi tienda' }).click();
    await expect(page.getByText('Tu tienda está publicada.')).toBeVisible();
    await expect(page.getByText('Publicada', { exact: true })).toBeVisible();
    const url = await page.getByRole('textbox', { name: 'Enlace de tu tienda' }).inputValue();
    expect(url).toMatch(/\/f\/las-camelias$/);

    // Chi compra, senza account.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const shopper = await visitor.newPage();
    // Dalla home per chi compra: città → ricerca → tienda.
    await shopper.goto('/');
    await expect(
      shopper.getByRole('heading', { level: 1, name: 'Flores de florerías locales, a domicilio' }),
    ).toBeVisible();
    await shopper.getByLabel('Ciudad').selectOption('Aguascalientes');
    await shopper.getByRole('button', { name: 'Buscar florerías' }).click();
    await expect(shopper).toHaveURL(/\/buscar\?ciudad=Aguascalientes$/);
    await expect(
      shopper.getByRole('heading', { level: 1, name: 'Florerías en Aguascalientes' }),
    ).toBeVisible();
    await shopper.getByRole('link', { name: /Florería Las Camelias/ }).click();
    await expect(shopper).toHaveURL(/\/f\/las-camelias$/);
    await expect(
      shopper.getByRole('heading', { level: 1, name: 'Florería Las Camelias' }),
    ).toBeVisible();
    await expect(shopper.getByText('Flores frescas en el centro de Aguascalientes.')).toBeVisible();
    await expect(shopper.getByText('Florería de demostración')).toBeVisible();
    await expect(shopper.getByText('CLABE 012345678901234567 (BBVA)')).toBeVisible();
    // Logo e copertina si vedono davvero (immagini caricate, non solo il tag).
    for (const name of ['Logo de Florería Las Camelias', 'Foto de Florería Las Camelias']) {
      const image = shopper.getByRole('img', { name });
      await expect(image).toBeVisible();
      expect(
        await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
    }
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

    // Senza copertina la pagina resta, solo senza l'immagine in alto.
    await page.getByRole('button', { name: 'Quitar portada' }).click();
    await expect(page.getByText('Imagen quitada.')).toBeVisible();
    await shopper.goto('/f/las-camelias');
    await expect(shopper.getByRole('img', { name: 'Foto de Florería Las Camelias' })).toHaveCount(
      0,
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
