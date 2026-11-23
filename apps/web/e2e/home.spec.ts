import { expect, test } from '@playwright/test';

/**
 * Home per chi compra e pagina per i fioristi (blocco C3, ADR-066): `/` parla a chi compra fiori,
 * `/floristas` presenta il gestionale e porta alla registrazione della fioreria.
 */
test('chi compra e chi ha una florería trovano ognuno la sua pagina', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Flores de florerías locales, a domicilio' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '¿A dónde enviamos tus flores?' })).toBeVisible();
  // Senza accesso niente ricerca dell'indirizzo con Google: si offre di entrare.
  await expect(page.getByText('¿Quieres buscar por la dirección exacta?')).toBeVisible();

  await page.getByRole('link', { name: 'Para florerías', exact: true }).click();
  await expect(page).toHaveURL(/\/floristas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tu florería, organizada de punta a punta' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Crear cuenta' }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText('Empieza a organizar tu florería en minutos.')).toBeVisible();
});

test('una búsqueda sin lugar o sin resultados lo dice', async ({ page }) => {
  await page.goto('/buscar');
  await expect(page.getByText('Elige una dirección o una ciudad para buscar.')).toBeVisible();
  await page.goto('/buscar?ciudad=Ciudad%20Inexistente');
  await expect(page.getByText('Aún no hay florerías que entreguen ahí.')).toBeVisible();
  await page.getByRole('link', { name: 'Buscar en otro lugar' }).click();
  await expect(page).toHaveURL(/\/$/);
});
