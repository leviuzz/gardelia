import { expect, test as setup } from '@playwright/test';

/**
 * Login una sola volta per ruolo (gli endpoint di accesso hanno un rate limit):
 * gli altri test riutilizzano lo stato salvato.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-floral-2026';

const accounts = [
  { file: 'owner', email: 'duena@lascamelias.test', landing: /\/app\/las-camelias$/ },
  { file: 'staff', email: 'staff@lascamelias.test', landing: /\/app\/las-camelias$/ },
  { file: 'other-owner', email: 'dueno@floresdelvalle.test', landing: /\/app\/flores-del-valle$/ },
] as const;

for (const account of accounts) {
  setup(`login ${account.file}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(account.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(account.landing);
    await page.context().storageState({ path: `e2e/.auth/${account.file}.json` });
  });
}
