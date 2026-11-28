import { expect, test } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { ownClientHeaders } from './support/network';

test.use({ storageState: 'e2e/.auth/owner.json' });

test('invito via email: la persona invitata si registra, accetta ed entra come staff', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('equipo');
  // Nome univoco: il test resta ripetibile sullo stesso database.
  const fullName = `Carlos Méndez ${Date.now().toString(36)}`;

  await page.goto('/app/las-camelias/settings/team');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Rol', { exact: true }).selectOption('STAFF');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(`Invitación enviada a ${email}`)).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const invitation = await waitForEmail(email, { subject: 'te invitó' });
  const inviteUrl = linkFrom(invitation, '/invite/');

  // La persona invitata, in un browser "pulito" (senza la sessione della proprietaria).
  const guest = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: ownClientHeaders(),
  });
  const guestPage = await guest.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByText('te invitó a unirte como Equipo')).toBeVisible();
  await guestPage
    .getByRole('link', { name: '¿No tienes cuenta? Crea una con ese correo.' })
    .click();

  await guestPage.getByLabel('Nombre completo').fill(fullName);
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
  await expect(
    guestPage.getByRole('navigation').first().getByRole('link', { name: 'Equipo' }),
  ).toHaveCount(0);
  await guest.close();

  // Il proprietario lo vede ora tra i membri.
  await page.reload();
  await expect(page.getByText(fullName, { exact: true })).toBeVisible();

  // Disattivazione con conferma: la finestra si chiude solo a operazione riuscita.
  const memberRow = page.getByRole('listitem').filter({ hasText: fullName });
  await memberRow.getByRole('button', { name: 'Desactivar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`¿Desactivar a ${fullName}?`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByText('Miembro desactivado')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await memberRow.getByRole('button', { name: 'Reactivar' }).click();
  await expect(page.getByText('Miembro reactivado')).toBeVisible();
  await expect(memberRow.getByRole('button', { name: 'Desactivar' })).toBeVisible();
});

test('un invito si può cancellare: la riga sparisce e il toast lo conferma', async ({ page }) => {
  const email = uniqueEmail('revocar');
  await page.goto('/app/las-camelias/settings/team');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Rol', { exact: true }).selectOption('STAFF');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const invitationRow = page.getByRole('listitem').filter({ hasText: email });
  await invitationRow.getByRole('button', { name: 'Cancelar invitación' }).click();
  // Il toast arriva anche se il pulsante sparisce con la riga.
  await expect(page.getByText('Invitación cancelada')).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
});
