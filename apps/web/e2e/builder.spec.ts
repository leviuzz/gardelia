import { expect, test } from '@playwright/test';

test.describe('Bouquet Builder (fioreria demo, Plus in pilota)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('BQ-01: compone con prezzo live, salva e crea il preventivo con la distinta esatta', async ({
    page,
  }) => {
    // Cargo per l'armado fissato dal test: il totale atteso è deterministico.
    await page.goto('/app/las-camelias/settings');
    const laborFee = page.getByRole('textbox', { name: 'Cargo por armado (MXN)' });
    await laborFee.fill('50');
    await page
      .locator('form')
      .filter({ has: laborFee })
      .getByRole('button', { name: 'Guardar' })
      .click();
    await expect(page.getByText('Cargo por armado guardado')).toBeVisible();

    await page.goto('/app/las-camelias/quotes');
    await page.getByRole('link', { name: 'Diseñar ramo' }).click();
    await expect(page).toHaveURL(/\/builder\/new$/);

    const name = `Ramo E2E Builder ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Nombre del diseño' }).fill(name);
    await page.getByRole('spinbutton', { name: 'Cantidad de Rosa roja · Freedom' }).fill('7');
    await page.getByRole('button', { name: 'Agregar uno de Tulipán rosa' }).click();
    await page.getByRole('spinbutton', { name: 'Cantidad de Tulipán rosa' }).fill('5');
    await page.getByRole('radio', { name: /Papel coreano kraft/ }).check();

    // 7 × 35 + 5 × 55 + 30 (empaque) + 50 (armado) = 600 MXN, calcolato nel browser.
    await expect(page.getByTestId('builder-total')).toHaveText('$600.00');
    await expect(page.getByText('Tulipán rosa: disponibilidad limitada')).toBeVisible();

    await page.getByRole('button', { name: 'Guardar diseño' }).click();
    await expect(page).toHaveURL(/\/builder\/[0-9a-f-]{36}\?saved=1$/);
    await expect(page.getByText('Diseño guardado. Ya puedes crear la cotización.')).toBeVisible();
    await expect(page.getByTestId('builder-total')).toHaveText('$600.00');

    await page.getByRole('link', { name: 'Crear cotización' }).click();
    await expect(page.getByText(`Cotización del diseño «${name}»`)).toBeVisible();
    await page.getByRole('button', { name: 'Cotización para Hotel Casa Fuentes' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);

    // Il server ha ricalcolato lo stesso totale e salvato la distinta esatta.
    await expect(page.getByTestId('quote-total')).toHaveText('$600.00');
    await expect(page.getByText('Diseño personalizado')).toBeVisible();
    await expect(
      page.getByText('Incluye: 7 × Rosa roja Freedom, 5 × Tulipán rosa y 1 × Papel coreano kraft'),
    ).toBeVisible();
    await expect(page.getByText('Disponibilidad limitada')).toBeVisible();
  });
});

test.describe('Bouquet Builder (fioreria Basic)', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('senza Plus si vede l’invito all’upgrade, nessuna funzione finta', async ({ page }) => {
    await page.goto('/app/flores-del-valle/builder');
    await expect(
      page.getByRole('heading', { name: 'El diseñador de ramos está incluido en Floral OS Plus' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver mi plan' })).toBeVisible();
    await page.goto('/app/flores-del-valle/builder/new');
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
  });
});
