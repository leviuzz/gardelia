import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Anteprima esatta (ADR-034) con il provider simulato: la foto del fiore si scontorna in locale,
 * il boceto esatto appare subito (gratis) e la "foto realistica" (simulata, dichiarata come tale)
 * arriva con il numero di fiori verificato. La foto di "Rosa blanca" resta fra un'esecuzione e
 * l'altra: stessa composizione e stessa chiave, quindi dalla seconda volta l'anteprima si riusa
 * senza consumare crediti della fioreria demo.
 */
const ROSA = fileURLToPath(new URL('./fixtures/rosa.jpg', import.meta.url));

async function newDesign(page: Page, name: string, flower: string, quantity: number) {
  await page.goto('/app/las-camelias/builder/new');
  await page.getByRole('textbox', { name: 'Nombre del diseño' }).fill(name);
  await page.getByRole('spinbutton', { name: `Cantidad de ${flower}` }).fill(String(quantity));
  await page.getByRole('radio', { name: /Papel coreano kraft/ }).check();
  await page.getByRole('button', { name: 'Guardar diseño' }).click();
  await expect(page).toHaveURL(/\/builder\/[0-9a-f-]{36}\?saved=1$/);
}

test.describe('anteprima esatta (provider simulato)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('con la foto del fiore: boceto esatto, foto verificata, immagini private', async ({
    page,
    browser,
  }) => {
    await page.goto('/app/las-camelias/catalog?q=Rosa%20blanca');
    await page
      .getByRole('link', { name: /Rosa blanca/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible();
    const tiles = page.getByTestId('item-photos').getByRole('listitem');
    if ((await tiles.count()) === 0) {
      await page.getByRole('button', { name: 'Fotos', exact: true }).setInputFiles(ROSA);
      await page.getByRole('button', { name: 'Subir fotos' }).click();
      await expect(page.getByText('Se subió 1 foto')).toBeVisible();
    }
    await expect(tiles.first()).toHaveAttribute('data-cutout', 'READY', { timeout: 20_000 });

    const designName = `Rosas blancas exactas ${Date.now()}`;
    await newDesign(page, designName, 'Rosa blanca · Mondial', 3);

    // Boceto esatto: subito, gratis e privato.
    const sketch = page.getByRole('img', { name: /Boceto exacto del ramo/ }).first();
    await expect(sketch).toBeVisible();
    const sketchSrc = await sketch.getAttribute('src');
    expect(sketchSrc).toMatch(/\/builder\/[0-9a-f-]{36}\/sketch\?v=[0-9a-f]{16}$/);
    const response = await page.request.get(sketchSrc!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');

    const generate = page.getByRole('button', { name: 'Generar foto realista' });
    if (await generate.isVisible()) await generate.click();
    await expect(page.getByRole('img', { name: /Vista previa ilustrativa del ramo/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Número de flores verificado')).toBeVisible();
    await expect(page.getByText(/Simulación \(entorno de desarrollo\)/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver el boceto exacto' })).toBeVisible();

    // Nella cotización l'immagine resta con la riga, con l'avviso e il download per WhatsApp.
    await page.getByRole('link', { name: 'Crear cotización' }).click();
    await page.getByRole('button', { name: 'Cotización para Hotel Casa Fuentes' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    const quoteImage = page.getByRole('img', {
      name: `Imagen ilustrativa del ramo «${designName}»`,
    });
    await expect(quoteImage).toBeVisible();
    await expect(page.getByText('Número de flores verificado')).toBeVisible();
    const download = page.getByRole('link', { name: 'Descargar imagen para WhatsApp' });
    const downloadResponse = await page.request.get((await download.getAttribute('href'))!);
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()['content-disposition']).toMatch(
      /^attachment; filename="ramo\./,
    );

    const other = await browser.newContext({ storageState: 'e2e/.auth/other-owner.json' });
    for (const url of [sketchSrc!, (await quoteImage.getAttribute('src'))!]) {
      const otherUrl = url.replace('/app/las-camelias/', '/app/flores-del-valle/');
      expect((await other.request.get(otherUrl)).status()).toBe(404);
    }
    await other.close();
  });

  test('senza la foto di un fiore dice quale fotografare', async ({ page }) => {
    await newDesign(page, `Girasoles sin foto ${Date.now()}`, 'Girasol', 2);
    await expect(
      page.getByText('Para una vista previa con el número exacto de flores, sube una foto de:'),
    ).toBeVisible();
    const link = page.getByRole('link', { name: 'Girasol', exact: true });
    await expect(link).toHaveAttribute('href', /\/catalog\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('img', { name: /Boceto exacto del ramo/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generar vista previa' })).toBeVisible();
  });
});
