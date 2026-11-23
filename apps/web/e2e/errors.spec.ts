import { expect, test } from '@playwright/test';
import { E2E_CRON_SECRET } from '../playwright.config';

/**
 * Gestione degli errori (fase 0): una risorsa che non esiste (o di un'altra fioreria) risponde
 * 404 DENTRO il menu della fioreria, che resta utilizzabile; ogni risposta porta l'ID della
 * richiesta con cui si ritrova la riga di log.
 */
test.describe('errori nelle pagine della fioreria', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('una risorsa inesistente risponde 404 senza perdere il menu', async ({ page }) => {
    const response = await page.goto(
      '/app/las-camelias/quotes/01936f3e-0000-7000-8000-000000000000',
    );
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
    await expect(page.getByText('No encontramos lo que buscas o ya no existe.')).toBeVisible();

    // Il menu della fioreria resta: si va altrove senza ricaricare l'app.
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Ir al inicio' }).click();
    await expect(page).toHaveURL(/\/app\/las-camelias$/);
  });
});

test('ogni risposta, API comprese, porta l’ID della richiesta', async ({ request }) => {
  const api = await request.get('/api/health');
  expect(api.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  const page = await request.get('/login');
  expect(page.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(page.headers()['x-request-id']).not.toBe(api.headers()['x-request-id']);
});

test.describe('errori di validazione senza un campo visibile', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('se il server rifiuta un valore che il form non mostra, l’errore compare', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias/quotes/new');
    // Il cliente arriva dal pulsante premuto (nessun campo da segnare): simuliamo un valore
    // rifiutato dal server, come accadrebbe con una pagina vecchia o manomessa.
    const pick = page.getByRole('button', { name: /^Cotización para / }).first();
    await pick.evaluate((button) => button.setAttribute('value', 'no-es-un-id'));
    await pick.click();
    await expect(page.getByText('Este campo es obligatorio.')).toBeVisible();
    await expect(page).toHaveURL(/\/quotes\/new$/);
  });
});

test('la funzione dei job AI risponde solo con il segreto (404 altrimenti)', async ({
  request,
}) => {
  const path = '/api/internal/ai/drain';
  expect((await request.post(path)).status()).toBe(404);
  expect(
    (await request.post(path, { headers: { authorization: 'Bearer sbagliato' } })).status(),
  ).toBe(404);
  expect(
    (
      await request.post(path, { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } })
    ).status(),
  ).toBe(202);
});

test('i lavori giornalieri rispondono solo con il segreto e dicono cosa hanno fatto', async ({
  request,
}) => {
  const path = '/api/internal/maintenance';
  expect((await request.get(path)).status()).toBe(404);
  const response = await request.get(path, {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    quotesExpired: expect.any(Number),
    invitationsExpired: expect.any(Number),
    coordinatesPurged: expect.any(Number),
    promos: { tenants: expect.any(Number), sent: expect.any(Number), failed: expect.any(Number) },
  });
});
