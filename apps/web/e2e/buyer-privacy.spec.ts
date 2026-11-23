import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';

/**
 * Documenti legali e diritti di chi compra (marketplace, blocco C5, ADR-068): le pagine legali
 * dalla home e dalla registrazione; chi compra scarica i suoi dati ed elimina il conto con la
 * conferma per email, dopo di che non può più entrare.
 */
test('pagine legali, dati scaricati e conto eliminato con la conferma per email', async ({
  page,
}) => {
  // Dalla home: aviso e termini per chi compra, bozze dichiarate come tali.
  await page.goto('/');
  await page.getByRole('link', { name: 'Aviso de privacidad' }).click();
  await expect(page).toHaveURL(/\/privacidad$/);
  await expect(
    page.getByRole('heading', { level: 1, name: /Aviso de privacidad integral/ }),
  ).toBeVisible();
  await expect(page.getByRole('note').getByText(/BORRADOR/)).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Términos para compradores' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: /Términos para compradores/ }),
  ).toBeVisible();
  await page.goto('/terminos');
  await expect(
    page.getByRole('heading', { level: 1, name: /Términos y condiciones/ }),
  ).toBeVisible();

  // La registrazione di chi compra rimanda ai suoi termini.
  await page.goto('/signup?next=%2Fcuenta');
  await expect(page.getByRole('link', { name: 'Términos', exact: true })).toHaveAttribute(
    'href',
    '/terminos/compradores',
  );
  await expect(page.getByRole('link', { name: 'Aviso de privacidad' }).first()).toHaveAttribute(
    'href',
    '/privacidad',
  );

  const email = uniqueEmail('privacidad');
  const password = 'una-clave-segura-321';
  await page.getByLabel('Nombre completo').fill('Rocío Datos');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Confirma la contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
  await page.goto(linkFrom(verification, '/api/auth/verify-email'));
  await expect(page).toHaveURL(/\/cuenta$/);

  // "Descargar mis datos": un file con il conto della persona.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar mis datos' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^gardelia-mis-datos-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    account: { name: string; email: string };
    orders: unknown[];
  };
  expect(data.account).toMatchObject({ name: 'Rocío Datos', email });
  expect(data.orders).toEqual([]);

  // "Eliminar mi cuenta": prima l'email, poi il link, poi l'ultimo clic.
  await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Los pedidos que hiciste siguen en las florerías/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Enviar el correo de confirmación' }).click();
  await expect(page.getByText(/Te enviamos un correo\. Abre el enlace/)).toBeVisible();
  // Finché non si apre il link, il conto c'è ancora.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();

  const confirmation = await waitForEmail(email, { subject: 'eliminar tu cuenta' });
  await page.goto(linkFrom(confirmation, '/cuenta/eliminar?token='));
  await expect(page.getByRole('heading', { name: 'Eliminar tu cuenta' })).toBeVisible();
  await page.getByRole('button', { name: 'Sí, eliminar mi cuenta' }).click();
  await expect(page).toHaveURL(/\/cuenta-eliminada$/);
  await expect(page.getByRole('heading', { name: 'Tu cuenta fue eliminada' })).toBeVisible();

  // Il conto non esiste più: niente sessione, e le stesse credenziali non entrano.
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/login\?next=%2Fcuenta$/);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
});
