import { expect, test } from '@playwright/test';

test.describe('piano (fioreria demo in pilota)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il proprietario vede Plus in pilota con il Builder incluso', async ({ page }) => {
    await page.goto('/app/las-camelias/settings');
    await page.getByRole('link', { name: /Plan y funciones/ }).click();
    await expect(page).toHaveURL(/\/settings\/plan$/);
    await expect(page.getByTestId('current-plan')).toHaveText('Gardelia Plus');
    await expect(page.getByText('Piloto', { exact: true })).toBeVisible();
    const builder = page.getByRole('listitem').filter({ hasText: 'Diseñador de ramos' });
    await expect(builder.getByText('Incluido')).toBeVisible();
    // Nessun pagamento finto: la pagina dichiara che il cobro non è disponibile.
    await expect(page.getByText(/El cobro en línea todavía no está disponible/)).toBeVisible();
  });
});

test.describe('piano (fioreria senza abbonamento)', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('senza abbonamento si applica Basic e il Builder richiede Plus', async ({ page }) => {
    await page.goto('/app/flores-del-valle/settings/plan');
    await expect(page.getByTestId('current-plan')).toHaveText('Gardelia Basic');
    const builder = page.getByRole('listitem').filter({ hasText: 'Diseñador de ramos' });
    await expect(builder.getByText('Disponible en Plus')).toBeVisible();
  });
});

test.describe('piano (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff non accede alla pagina del piano', async ({ page }) => {
    await page.goto('/app/las-camelias/settings/plan');
    await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
  });
});
