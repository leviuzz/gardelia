import { expect, test } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * FLOW-A (spec §10): registrazione → verifica email reale → creazione fioreria → primo prodotto.
 */
test('un nuovo fiorista si registra, verifica l’email, crea la fioreria e il primo prodotto', async ({ page }) => {
  const email = uniqueEmail('nuevo');
  const shopName = `Florería E2E ${Date.now()}`;

  await page.goto('/signup');
  await page.getByLabel('Nombre completo').fill('Paola Ruiz');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('una-clave-segura-123');
  await page.getByLabel('Confirma la contraseña').fill('una-clave-segura-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  // Senza verifica non si entra.
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('una-clave-segura-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Tu correo aún no está confirmado')).toBeVisible();

  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await page.goto(linkFrom(verification, '/api/auth/verify-email'));

  // Utente verificato e autenticato, senza fiorerie → onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nombre comercial').fill(shopName);
  await page.getByLabel('Teléfono de contacto').fill('449 555 0123');
  await page.getByLabel('Calle y número').fill('Av. Universidad 940');
  await page.getByLabel('Colonia').fill('Ciudad Universitaria');
  await page.getByLabel('Código postal').fill('20131');
  await page.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
  await page.getByRole('button', { name: 'Crear mi florería' }).click();

  await expect(page).toHaveURL(/\/app\/floreria-e2e-\d+$/);
  await expect(page.getByRole('heading', { name: 'Hola, Paola' })).toBeVisible();
  await expect(page.getByText('Agrega tu primer producto')).toBeVisible();

  await page.getByRole('link', { name: 'Catálogo' }).first().click();
  await expect(page.getByText('Tu catálogo está vacío')).toBeVisible();
  await page.getByRole('link', { name: 'Nuevo producto' }).first().click();
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Rosa roja');
  await page.getByLabel('Precio de venta (MXN)').fill('38.50');
  await page.getByLabel('Costo estimado (MXN)').fill('15');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  await expect(page.getByText('Producto creado')).toBeVisible();
  await page.getByRole('link', { name: 'Volver' }).click();
  await expect(page.getByRole('table').getByText('$38.50')).toBeVisible();
});
