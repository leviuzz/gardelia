import { expect, test } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * Conto del cliente del marketplace (blocco C1): chi compra si registra da "Mi cuenta", verifica
 * l'email, salva telefono e indirizzo; agli accessi successivi torna a "Mi cuenta", non alla
 * creazione di una fioreria.
 */
test('chi compra si registra, salva i suoi dati e torna sempre a "Mi cuenta"', async ({ page }) => {
  const email = uniqueEmail('cliente');
  const password = 'una-clave-segura-456';

  // Senza sessione "Mi cuenta" porta al login, con i testi per chi compra.
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/login\?next=%2Fcuenta$/);
  await expect(page.getByText('Entra a tu cuenta.')).toBeVisible();
  await page.getByRole('link', { name: 'Regístrate' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fcuenta$/);
  await expect(page.getByText('Guarda tus datos y tus direcciones de entrega.')).toBeVisible();

  await page.getByLabel('Nombre completo').fill('Lucía Pérez');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Confirma la contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  // "Reenviar" e "Iniciar sesión" ricordano la destinazione.
  await expect(page).toHaveURL(/next=%2Fcuenta/);

  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await page.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByText('Hola, Lucía Pérez.')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // Telefono: uno sbagliato dà l'errore sul campo, poi si salva.
  const phone = page.getByLabel('Teléfono');
  await phone.fill('123');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Escribe un teléfono de 10 dígitos.')).toBeVisible();
  await phone.fill('449 555 0177');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();

  // Primo indirizzo: diventa il predefinito.
  await page.getByRole('button', { name: 'Agregar dirección' }).click();
  await page.getByLabel('Etiqueta').fill('Casa de mamá');
  await page.getByLabel('Calle y número').fill('Av. Madero 120');
  await page.getByLabel('Colonia').fill('Centro');
  await page.getByLabel('Código postal').fill('20000');
  await page.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
  await page.getByRole('button', { name: 'Agregar dirección' }).click();
  await expect(page.getByText('Dirección agregada')).toBeVisible();
  const saved = page.getByRole('listitem').filter({ hasText: 'Casa de mamá' });
  await expect(saved.getByText('Predeterminada')).toBeVisible();
  await expect(saved.getByText('Av. Madero 120, Centro')).toBeVisible();

  // Chi non ha una fioreria vede come aprirne una.
  await expect(page.getByRole('link', { name: 'Registrar mi florería' })).toHaveAttribute(
    'href',
    '/onboarding',
  );

  // Uscire e rientrare dal login normale: si torna a "Mi cuenta", non all'onboarding.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByLabel('Teléfono')).toHaveValue('449 555 0177');
});
