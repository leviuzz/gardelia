import { expect, test } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

test.use({ storageState: 'e2e/.auth/owner.json' });

test('invito via email: la persona invitata si registra, accetta ed entra come staff', async ({ page, browser }) => {
  const email = uniqueEmail('equipo');

  await page.goto('/app/las-camelias/settings/team');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Rol', { exact: true }).selectOption('STAFF');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(`Invitación enviada a ${email}`)).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const invitation = await waitForEmail(email, { subject: 'te invitó' });
  const inviteUrl = linkFrom(invitation, '/invite/');

  // La persona invitata, in un browser "pulito" (senza la sessione della proprietaria).
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByText('te invitó a unirte como Equipo')).toBeVisible();
  await guestPage.getByRole('link', { name: '¿No tienes cuenta? Crea una con ese correo.' }).click();

  await guestPage.getByLabel('Nombre completo').fill('Carlos Méndez');
  await expect(guestPage.getByLabel('Correo electrónico')).toHaveValue(email);
  await guestPage.getByLabel('Contraseña', { exact: true }).fill('clave-del-equipo-456');
  await guestPage.getByLabel('Confirma la contraseña').fill('clave-del-equipo-456');
  await guestPage.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(guestPage.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await guestPage.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(guestPage).toHaveURL(/\/invite\//);
  await guestPage.getByRole('button', { name: 'Aceptar invitación' }).click();

  await expect(guestPage).toHaveURL(/\/app\/las-camelias$/);
  await expect(guestPage.getByRole('heading', { name: 'Hola, Carlos' })).toBeVisible();
  // Come staff non vede la voce "Equipo" nella navigazione.
  await expect(guestPage.getByRole('navigation').first().getByRole('link', { name: 'Equipo' })).toHaveCount(0);
  await guest.close();

  // Il proprietario lo vede ora tra i membri.
  await page.reload();
  await expect(page.getByText('Carlos Méndez')).toBeVisible();
});
