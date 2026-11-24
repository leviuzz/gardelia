import { expect, test, type Page } from '@playwright/test';
import { signUpWithNewShop } from './support/shop';
import { runSystemSql } from './support/sql';
import { totpCode } from './support/totp';

/**
 * Sicurezza del conto (ADR-077): il titolare attiva la verifica in due passaggi (QR, primo codice,
 * codici di respaldo), l'accesso chiede il codice, un dispositivo si chiude da un altro; passati 14
 * giorni senza attivarla la fioreria non si apre.
 */

const PASSWORD = 'una-clave-segura-123';

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('verificación en dos pasos: activar, entrar con el código y cerrar otro dispositivo', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const shopName = `Florería Segura ${Date.now()}`;
  const { email, slug } = await signUpWithNewShop(page, { name: 'Sofía Ruiz', shopName });

  // Titolare nuovo: l'avviso con la data, che porta alla sicurezza del conto.
  await expect(page.getByTestId('two-factor-banner')).toContainText(
    'Activa la verificación en dos pasos antes del',
  );
  await page.getByTestId('two-factor-banner').getByRole('link', { name: 'Activarla' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Seguridad de la cuenta' }),
  ).toBeVisible();

  // Password → QR e chiave → primo codice → codici di respaldo.
  await page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
  await page.getByLabel('Tu contraseña').fill('no-es-mi-clave');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Contraseña incorrecta.')).toBeVisible();
  await page.getByLabel('Tu contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    page.getByRole('img', { name: 'Código QR para tu app de autenticación' }),
  ).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent()) ?? '';
  await page.getByLabel('Código de la app').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const codes = page.getByTestId('backup-codes');
  await expect(codes).toContainText('Listo: la verificación en dos pasos está activa.');
  const backupCodes = await codes.locator('li').allTextContents();
  expect(backupCodes).toHaveLength(10);
  const listo = page.getByRole('button', { name: 'Listo' });
  await expect(listo).toBeDisabled();
  await page.getByLabel('Guardé mis códigos en un lugar seguro').check();
  await listo.click();
  await expect(page.getByText('Activa', { exact: true })).toBeVisible();

  // L'avviso nel pannello sparisce.
  await page.goto(`/app/${slug}`);
  await expect(page.getByTestId('two-factor-banner')).toHaveCount(0);

  // Altro dispositivo: dopo la password, il codice.
  const phone = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await phone.newPage();
  await signIn(other, email);
  await expect(other).toHaveURL(/\/verificacion/);
  await other.getByLabel('Código de 6 números').fill('000000');
  await other.getByRole('button', { name: 'Entrar' }).click();
  await expect(other.getByText(/Código incorrecto/)).toBeVisible();
  // Senza il telefono: un codice di respaldo (vale una volta).
  await other.getByRole('button', { name: /usar un código de respaldo/ }).click();
  await other.getByLabel('Código de respaldo').fill(backupCodes[0]!);
  await other.getByRole('button', { name: 'Entrar' }).click();
  await expect(other).toHaveURL(new RegExp(`/app/${slug}$`));

  // Dal primo dispositivo si chiude la sessione dell'altro.
  await page.goto('/seguridad');
  const sessions = page.getByTestId('sessions');
  await expect(sessions.getByRole('listitem')).toHaveCount(2);
  await expect(sessions.getByText('Este dispositivo')).toBeVisible();
  await sessions.getByRole('button', { name: /^Cerrar la sesión de / }).click();
  await expect(page.getByText('Sesión cerrada')).toBeVisible();
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await phone.close();

  // Lo stesso codice di respaldo non vale due volte; il codice dell'app sì.
  const again = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const third = await again.newPage();
  await signIn(third, email);
  await expect(third).toHaveURL(/\/verificacion/);
  await third.getByRole('button', { name: /usar un código de respaldo/ }).click();
  await third.getByLabel('Código de respaldo').fill(backupCodes[0]!);
  await third.getByRole('button', { name: 'Entrar' }).click();
  await expect(third.getByText('Ese código de respaldo no es válido o ya se usó.')).toBeVisible();
  await third.getByRole('button', { name: 'Usar el código de la app' }).click();
  await third.getByLabel('Código de 6 números').fill(totpCode(secret));
  await third.getByRole('button', { name: 'Entrar' }).click();
  await expect(third).toHaveURL(new RegExp(`/app/${slug}$`));
  await again.close();
});

test('pasados 14 días sin activarla, la florería no se abre', async ({ page }) => {
  test.setTimeout(90_000);
  const shopName = `Florería Sin Verificación ${Date.now()}`;
  const { slug } = await signUpWithNewShop(page, { name: 'Raúl Díaz', shopName });
  await expect(page.getByTestId('two-factor-banner')).toBeVisible();

  // Come se la fioreria fosse stata creata 15 giorni fa.
  runSystemSql(
    `UPDATE "Membership" m SET "updatedAt" = now() - interval '15 days'
       FROM "Tenant" t WHERE m."tenantId" = t.id AND t.slug = '${slug}' AND m.role = 'OWNER'`,
  );
  await page.goto(`/app/${slug}/orders`);
  await expect(page).toHaveURL(/\/seguridad\?requerida=1/);
  await expect(page.getByTestId('two-factor-required')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Activar verificación en dos pasos' }),
  ).toBeVisible();
});
