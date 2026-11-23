import { expect, test } from '@playwright/test';

const CATALOG = '/app/las-camelias/catalog';

/**
 * L'elenco del catalogo è paginato (20 per pagina, fiori prima dei ramos) e il database E2E locale
 * conserva i prodotti creati dagli altri test: i prodotti del seed si cercano per nome, così non
 * finiscono fuori dalla prima pagina.
 */
function catalogSearch(name: string): string {
  return `${CATALOG}?q=${encodeURIComponent(name)}`;
}

test.describe('staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('consulta il catalogo senza costi né azioni di modifica', async ({ page }) => {
    await page.goto(catalogSearch('Rosa roja'));
    await expect(page.getByRole('table').getByText('Rosa roja')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Costo' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Nuevo producto' })).toHaveCount(0);

    await page.goto(catalogSearch('Ramo Clásico 12 rosas'));
    await page.getByRole('table').getByText('Ramo Clásico 12 rosas').click();
    await expect(
      page.getByText('Los costos y márgenes solo son visibles para propietarios y gerentes.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archivar' })).toHaveCount(0);
  });

  test('non accede a creazione articoli, impostazioni e team', async ({ page }) => {
    for (const path of ['catalog/new', 'settings', 'settings/team']) {
      await page.goto(`/app/las-camelias/${path}`);
      await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
    }
  });
});

test.describe('proprietario di un’altra fioreria', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('non vede la fioreria demo né i suoi articoli', async ({ page, browser }) => {
    // Recupera l'URL reale di un articolo di "las-camelias" con la sessione del suo proprietario.
    const ownerContext = await browser.newContext({ storageState: 'e2e/.auth/owner.json' });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(catalogSearch('Rosa roja'));
    const href = await ownerPage
      .getByRole('table')
      .getByRole('link', { name: /Rosa roja/ })
      .first()
      .getAttribute('href');
    await ownerContext.close();
    expect(href).toMatch(/\/app\/las-camelias\/catalog\/[0-9a-f-]{36}$/);

    const direct = await page.goto(href!);
    expect(direct?.status()).toBe(404);
    // Anche "trapiantando" l'ID nel proprio slug, l'articolo non esiste.
    const transplanted = await page.goto(href!.replace('las-camelias', 'flores-del-valle'));
    expect(transplanted?.status()).toBe(404);
  });
});
