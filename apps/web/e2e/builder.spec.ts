import { expect, test, type Page } from '@playwright/test';

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

test.describe('carta e nastro con colore (ADR-030)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il colore di carta e nastro è obbligatorio, si salva e arriva nella cotización', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias/builder/new');
    await page
      .getByRole('textbox', { name: 'Nombre del diseño' })
      .fill(`Ramo colores ${Date.now()}`);
    await page.getByRole('spinbutton', { name: 'Cantidad de Girasol' }).fill('3');
    await page.getByRole('radio', { name: /^Papel coreano(?! kraft)/ }).check();

    // Senza colore non si salva: si chiede di sceglierlo.
    await expect(page.getByText('Elige el color de Papel coreano.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
    const paperColors = page.getByRole('group', { name: 'Color de Papel coreano' });
    await paperColors.getByText('Lila').click();
    await expect(paperColors.getByRole('radio', { name: 'Lila' })).toBeChecked();

    await page.getByRole('button', { name: 'Agregar uno de Listón de organza' }).click();
    const ribbonColors = page.getByRole('group', { name: 'Color de Listón de organza' });
    await ribbonColors.getByText('Dorado').click();
    await expect(page.getByText('1 × Papel coreano · Lila')).toBeVisible();
    await expect(page.getByText('1 × Listón de organza · Dorado')).toBeVisible();

    await page.getByRole('button', { name: 'Guardar diseño' }).click();
    await expect(page).toHaveURL(/\/builder\/[0-9a-f-]{36}\?saved=1$/);
    // Dopo il salvataggio i colori restano quelli scelti.
    await expect(
      page
        .getByRole('group', { name: 'Color de Papel coreano' })
        .getByRole('radio', { name: 'Lila' }),
    ).toBeChecked();

    await page.getByRole('link', { name: 'Crear cotización' }).click();
    await page.getByRole('button', { name: 'Cotización para Hotel Casa Fuentes' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText(
        'Incluye: 3 × Girasol, 1 × Listón de organza (dorado) y 1 × Papel coreano (lila)',
      ),
    ).toBeVisible();
  });
});

test.describe('anteprima AI (provider simulato)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  async function saveDesign(page: Page, name: string) {
    await page.goto('/app/las-camelias/builder/new');
    await page.getByRole('textbox', { name: 'Nombre del diseño' }).fill(name);
    // Stessa composizione a ogni esecuzione: dalla seconda in poi si riusa la cache.
    await page.getByRole('spinbutton', { name: 'Cantidad de Girasol' }).fill('3');
    await page.getByRole('radio', { name: /Papel coreano kraft/ }).check();
    await page.getByRole('button', { name: 'Guardar diseño' }).click();
    await expect(page).toHaveURL(/\/builder\/[0-9a-f-]{36}\?saved=1$/);
  }

  test('si genera su richiesta, è dichiarata come simulazione e si riusa per lo stesso ramo', async ({
    page,
    browser,
  }) => {
    await saveDesign(page, `Girasoles IA ${Date.now()}`);
    await expect(page.getByText(/Este mes: quedan \d+ de 25/)).toBeVisible();
    const generate = page.getByRole('button', { name: 'Generar vista previa' });
    if (await generate.isVisible()) await generate.click();
    const image = page.getByRole('img', { name: /Vista previa ilustrativa del ramo/ });
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Simulación \(entorno de desarrollo\)/)).toBeVisible();
    await expect(page.getByText(/el ramo real puede variar/)).toBeVisible();

    // Un altro disegno con la stessa composizione riusa l'immagine senza consumare.
    await saveDesign(page, `Girasoles IA bis ${Date.now()}`);
    await expect(
      page.getByRole('img', { name: /Vista previa ilustrativa del ramo/ }),
    ).toBeVisible();
    await expect(page.getByText('Ya existía una vista previa de este mismo ramo')).toBeVisible();

    // L'immagine è privata: un'altra fioreria riceve 404.
    const src = await page
      .getByRole('img', { name: /Vista previa ilustrativa del ramo/ })
      .getAttribute('src');
    expect(src).toMatch(/\/builder\/previews\/[0-9a-f-]{36}$/);
    expect((await page.request.get(src!)).status()).toBe(200);
    const other = await browser.newContext({ storageState: 'e2e/.auth/other-owner.json' });
    const otherSrc = src!.replace('/app/las-camelias/', '/app/flores-del-valle/');
    expect((await other.request.get(otherSrc)).status()).toBe(404);
    await other.close();
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
