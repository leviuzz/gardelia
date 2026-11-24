import { expect, test } from '@playwright/test';

/**
 * Fase di prova (D-29): ogni fioreria ha tutte le funzioni; le anteprime con IA si generano con
 * quelle incluse nel piano assegnato (la demo ha Plus) o con i crediti, che si comprano su WhatsApp.
 */
test.describe('piano (fioreria demo in pilota)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('tutto incluso, le anteprime del mese e il WhatsApp per i crediti', async ({ page }) => {
    await page.goto('/app/las-camelias/settings');
    await page.getByRole('link', { name: /Plan y funciones/ }).click();
    await expect(page).toHaveURL(/\/settings\/plan$/);
    await expect(page.getByTestId('current-plan')).toHaveText('Todo incluido');
    const builder = page.getByRole('listitem').filter({ hasText: 'Diseñador de ramos' });
    await expect(builder.getByText('Incluido')).toBeVisible();
    const ai = page.getByRole('listitem').filter({ hasText: 'Vistas previas con IA' });
    await expect(ai.getByText('Con créditos')).toBeVisible();
    await expect(page.getByTestId('ai-usage')).toContainText('Vistas previas con IA este mes');
    await expect(page.getByRole('link', { name: 'Comprar créditos por WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/524490000000\?text=/,
    );
  });
});

test.describe('piano (fioreria senza abbonamento)', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('tutto incluso anche senza abbonamento; le anteprime con IA solo con crediti', async ({
    page,
  }) => {
    await page.goto('/app/flores-del-valle/settings/plan');
    await expect(page.getByTestId('current-plan')).toHaveText('Todo incluido');
    for (const feature of ['Diseñador de ramos', 'Inventario']) {
      await expect(
        page.getByRole('listitem').filter({ hasText: feature }).getByText('Incluido'),
      ).toBeVisible();
    }
    await expect(page.getByTestId('ai-usage')).toContainText(
      'No tienes créditos para vistas previas con IA.',
    );
    await expect(page.getByRole('link', { name: 'Comprar créditos por WhatsApp' })).toBeVisible();
  });
});

test.describe('piano (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff non accede alla pagina del piano', async ({ page }) => {
    await page.goto('/app/las-camelias/settings/plan');
    await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
  });
});
