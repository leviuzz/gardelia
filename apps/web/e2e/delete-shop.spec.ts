import { expect, test } from '@playwright/test';
import { linkFrom, waitForEmail } from './support/mailbox';
import { signUpWithNewShop } from './support/shop';

/**
 * "Eliminar florería" (ADR-074): il titolare conferma col nome, la fioreria sparisce subito, arriva
 * l'email con la data e dalla scelta della fioreria si recupera. Chi non è titolare non elimina.
 */

test.describe('eliminare la fioreria (titolare nuovo)', () => {
  test("si elimina scrivendo il nome, sparisce, arriva l'email e si recupera", async ({ page }) => {
    const shopName = `Florería Adiós ${Date.now()}`;
    const { email, slug } = await signUpWithNewShop(page, { name: 'Elena Ruiz', shopName });

    await page.goto(`/app/${slug}/settings`);
    await page.getByRole('link', { name: 'Eliminar florería…' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `Eliminar ${shopName}` }),
    ).toBeVisible();
    await expect(page.getByText(/se borra definitivamente, sin vuelta atrás/)).toBeVisible();

    const confirm = page.getByLabel(`Nombre de la florería: ${shopName}`);
    const submit = page.getByRole('button', { name: 'Eliminar florería' });
    await expect(submit).toBeDisabled();
    await confirm.fill('Otra florería');
    await expect(submit).toBeDisabled();
    // Maiuscole e spazi non contano.
    await confirm.fill(`  ${shopName.toUpperCase()} `);
    await submit.click();

    await expect(page).toHaveURL(/\/app\?eliminacion=programada$/);
    await expect(page.getByTestId('deletion-scheduled')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Florerías en eliminación' })).toBeVisible();
    await expect(page.getByText(shopName)).toBeVisible();

    const mail = await waitForEmail(email, { subject: `${shopName} se eliminará el` });
    expect(linkFrom(mail, '/app')).toMatch(/\/app$/);

    // Nessuno la apre più, nemmeno il titolare.
    await page.goto(`/app/${slug}`);
    await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();

    await page.goto('/app');
    await page.getByRole('button', { name: `Recuperar ${shopName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${slug}$`));
    await page.goto('/app');
    // Con una sola fioreria si entra direttamente: nessuna voce "in eliminazione".
    await expect(page).toHaveURL(new RegExp(`/app/${slug}$`));
  });
});

test.describe('chi non è titolare', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('non apre la pagina di eliminazione', async ({ page }) => {
    await page.goto('/app/las-camelias/settings/delete');
    await expect(page.getByRole('heading', { name: 'Sin acceso a esta sección' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminar florería' })).toHaveCount(0);
  });
});

test.describe('titolare della fioreria demo', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('vede la zona di pericolo nelle impostazioni (senza usarla)', async ({ page }) => {
    await page.goto('/app/las-camelias/settings');
    await expect(page.getByTestId('danger-zone')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Eliminar florería…' })).toBeVisible();
  });
});
