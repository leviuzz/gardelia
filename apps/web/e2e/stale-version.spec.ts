import { expect, test, type Page } from '@playwright/test';

/**
 * Pagina aperta prima di un rilascio (visto dal founder su staging cambiando l'indirizzo della
 * tienda): il server non conosce più l'azione del form. Niente "Algo salió mal" con un
 * "Reintentar" che non può funzionare: si spiega che c'è una versione nuova e si offre di
 * ricaricare. La risposta del server dopo un rilascio è simulata, quindi nessun dato cambia.
 */

const SETTINGS = '/app/las-camelias/settings';

/** Il form dell'indirizzo della tienda (quello del founder), riconosciuto dal raggio di consegna. */
const locationForm = (page: Page) =>
  page
    .locator('form')
    .filter({ has: page.getByRole('spinbutton', { name: 'Radio de entrega (km)' }) });

/** Come risponde il server a un'azione della versione precedente (intestazione di Next.js). */
async function simulateNewRelease(page: Page): Promise<void> {
  await page.route(`**${SETTINGS}`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      await route.fulfill({ status: 404, headers: { 'x-nextjs-action-not-found': '1' } });
      return;
    }
    await route.continue();
  });
}

test.describe('versione nuova durante il lavoro (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test("form con il confine d'errore: avviso chiaro, menu presente e ricarica", async ({
    page,
  }) => {
    await page.goto(SETTINGS);
    await simulateNewRelease(page);
    await locationForm(page).getByRole('button', { name: 'Guardar cambios' }).click();

    const notice = page.getByTestId('stale-version');
    await expect(
      notice.getByRole('heading', { name: 'Hay una versión nueva de Gardelia' }),
    ).toBeVisible();
    await expect(page.getByText('Algo salió mal')).toHaveCount(0);
    // Il confine è dentro il layout: il menu della fioreria resta.
    await expect(page.getByRole('link', { name: 'Pedidos' }).first()).toBeVisible();

    await notice.getByRole('button', { name: 'Recargar la página' }).click();
    await expect(locationForm(page).getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test('form con i toast: il form resta e un avviso offre di ricaricare', async ({ page }) => {
    await page.goto(SETTINGS);
    await simulateNewRelease(page);
    const fee = page.getByRole('textbox', { name: 'Costo de envío habitual (MXN)' });
    await fee.fill('95');
    await page
      .locator('form')
      .filter({ has: page.getByRole('checkbox', { name: 'Domingo' }) })
      .getByRole('button', { name: 'Guardar' })
      .click();

    await expect(
      page.getByText('Gardelia se actualizó: recarga la página y vuelve a intentarlo.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recargar la página' })).toBeVisible();
    // Quello che si era scritto è ancora lì.
    await expect(fee).toHaveValue('95');
    await expect(page.getByTestId('stale-version')).toHaveCount(0);
  });
});
