import { expect, test } from '@playwright/test';
import { createProduct } from './support/catalog';

test.use({ storageState: 'e2e/.auth/owner.json' });

test.describe('catalogo (proprietario)', () => {
  test('valida, crea, modifica e archivia un articolo', async ({ page }) => {
    const name = `Hortensia azul ${Date.now()}`;
    await page.goto('/app/las-camelias/catalog/new');

    // Passo 1: senza nome non si va avanti (il browser segnala il campo).
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: '¿Qué vas a agregar?' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nombre', exact: true })).toBeFocused();
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: colori.
    await expect(page.getByRole('heading', { name: '¿En qué colores lo tienes?' })).toBeVisible();
    await page.getByText('Azul', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 3: validazione lato server del prezzo, si resta sul passo.
    await expect(page.getByRole('heading', { name: '¿Cuánto cuesta?' })).toBeVisible();
    await page.getByLabel('Precio de venta (MXN)').fill('12,345.00');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Escribe un importe válido')).toBeVisible();
    // Si torna indietro senza perdere nulla.
    await page.getByRole('button', { name: 'Atrás' }).click();
    await expect(page.getByRole('heading', { name: '¿En qué colores lo tienes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByLabel('Precio de venta (MXN)').fill('95');
    await page.getByRole('button', { name: 'Crear producto' }).click();

    // Passo 4: foto, che si può saltare; passo 5: listo.
    await expect(page.getByText('Producto creado')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agrega una foto' })).toBeVisible();
    await page.getByRole('link', { name: 'Saltar por ahora' }).click();
    await expect(
      page.getByRole('heading', { name: `¡Listo! «${name}» ya está en tu catálogo.` }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Ver el producto' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

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
    await createProduct(page, { type: 'BOUQUET', name: bouquet, price: '500' });
    await page.getByRole('link', { name: 'Saltar por ahora' }).click();
    await page.getByRole('link', { name: 'Armar la receta' }).click();
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

    // La quantità di una riga si aggiorna sul posto e i costi si ricalcolano (12 × 14.00).
    const roseLine = page
      .getByRole('listitem')
      .filter({ hasText: 'Rosa roja' })
      .filter({ has: page.getByRole('spinbutton') });
    await roseLine.getByRole('spinbutton', { name: 'Cantidad' }).fill('12');
    await roseLine.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.getByText('Cantidad actualizada')).toBeVisible();
    await expect(costing.getByText('$168.00')).toBeVisible();
  });
});

test.describe('isolamento', () => {
  test('lo slug di un’altra fioreria risponde 404', async ({ page }) => {
    const response = await page.goto('/app/flores-del-valle/catalog');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Página no encontrada')).toBeVisible();
  });
});

test.describe('specie del prodotto (ADR-043)', () => {
  test('suggerita dal nome, cercata nella propria lingua e salvata', async ({ page }) => {
    const name = `Nube blanca ${Date.now()}`;
    await page.goto('/app/las-camelias/catalog/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    const species = page.getByRole('combobox', { name: 'Especie' });
    // Il nome dice che fiore è: la specie arriva da sola, dichiarata.
    await expect(species).toHaveValue('Nube (Gypsophila)');
    await expect(page.getByText('Sugerida por el nombre del producto.')).toBeVisible();
    await expect(page.getByText(/Escribe el nombre de la flor en español/)).toBeVisible();

    // Si cerca nella lingua dell'interfaccia; un nome di un'altra lingua trova lo stesso fiore.
    await species.fill('garofano');
    await expect(page.getByRole('option', { name: /Clavel.*también «Garofano»/ })).toBeVisible();
    await species.fill('xyz');
    await expect(page.getByText('Ninguna especie con «xyz».', { exact: false })).toBeVisible();
    await species.fill('lis');
    await page.getByRole('option', { name: /^Lisianthus/ }).click();
    await expect(species).toHaveValue('Lisianthus');
    await expect(page.getByText('Sugerida por el nombre del producto.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByLabel('Precio de venta (MXN)').fill('35');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Producto creado')).toBeVisible();
    await page.getByRole('link', { name: 'Saltar por ahora' }).click();
    await page.getByRole('link', { name: 'Ver el producto' }).click();
    await expect(page.getByRole('combobox', { name: 'Especie' })).toHaveValue('Lisianthus');

    // Con la tastiera: frecce e Invio scelgono senza inviare il modulo.
    await species.fill('alcatr');
    await species.press('ArrowDown');
    await species.press('Enter');
    await expect(species).toHaveValue('Alcatraz');
    await page.getByRole('button', { name: 'Quitar especie' }).click();
    await expect(species).toHaveValue('');

    await page.getByRole('button', { name: 'Archivar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByText('Este producto está archivado.')).toBeVisible();
  });

  test('in italiano si cerca con i nomi italiani, con la nota sulla lingua', async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'it-IT', url: baseURL ?? '' }]);
    await page.goto('/app/las-camelias/catalog/new');
    const species = page.getByRole('combobox', { name: 'Specie' });
    await expect(page.getByText(/Scrivi il nome del fiore in italiano/)).toBeVisible();
    const firstResult = page.getByRole('listbox', { name: 'Specie' }).getByRole('option').first();
    await species.fill('garofano');
    await expect(firstResult).toHaveText(/^Garofano/);
    await species.fill('girasole');
    await expect(firstResult).toHaveText(/^Girasole/);
    // Il nome del prodotto in spagnolo basta: la specie si mostra in italiano.
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Rosa roja');
    await species.blur();
    await expect(species).toHaveValue('Rosa');
    await expect(page.getByText('Suggerita dal nome del prodotto.')).toBeVisible();
  });
});
