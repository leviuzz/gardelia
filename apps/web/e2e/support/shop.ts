import { expect, type Page } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './mailbox';

/**
 * Una fioreria REALE (non demo) appena creata: registrazione, verifica dell'email e onboarding,
 * come un nuovo fiorista. Serve ai flussi che le fiorerie demo non fanno mai (es. email ai
 * clienti, ADR-016). La pagina resta autenticata come proprietario della nuova fioreria.
 */
export async function signUpWithNewShop(
  page: Page,
  input: { readonly name: string; readonly shopName: string },
): Promise<{ readonly email: string; readonly slug: string }> {
  const email = uniqueEmail('fiorista');
  const password = 'una-clave-segura-123';
  await page.goto('/signup');
  await page.getByLabel('Nombre completo').fill(input.name);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Confirma la contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await page.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nombre comercial').fill(input.shopName);
  await page.getByLabel('Teléfono de contacto').fill('449 555 0123');
  // Creazione della fioreria a passi: prima la fioreria, poi l'indirizzo.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Calle y número').fill('Av. Universidad 940');
  await page.getByLabel('Colonia').fill('Ciudad Universitaria');
  await page.getByLabel('Código postal').fill('20131');
  await page.getByLabel('Municipio o alcaldía').fill('Aguascalientes');
  await page.getByRole('button', { name: 'Crear mi florería' }).click();
  await expect(page).toHaveURL(/\/app\/[a-z0-9-]+$/);
  const slug = new URL(page.url()).pathname.split('/')[2] ?? '';
  return { email, slug };
}
