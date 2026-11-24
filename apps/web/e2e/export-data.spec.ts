import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signUpWithNewShop } from './support/shop';

/**
 * "Descargar los datos de la florería" (ADR-079): il titolare scarica lo ZIP da Ajustes (e dal
 * promemoria nella pagina di eliminazione); chi non è titolare non lo ottiene nemmeno con l'URL.
 */

test('il titolare scarica lo ZIP con i dati della fioreria', async ({ page }) => {
  test.setTimeout(90_000);
  const { slug } = await signUpWithNewShop(page, {
    name: 'Inés Robles',
    shopName: `Florería Datos ${Date.now()}`,
  });
  await page.goto(`/app/${slug}/settings`);
  const card = page.getByTestId('export-data');
  await expect(card).toContainText('Datos de tu florería');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Descargar los datos (ZIP)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^gardelia-${slug}-\\d{4}-\\d{2}-\\d{2}\\.zip$`),
  );
  const bytes = readFileSync(await download.path());
  // Un archivio ZIP vero ("PK\x03\x04") con dentro il LEEME.
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(bytes.includes(Buffer.from('LEEME.txt'))).toBe(true);
  expect(bytes.includes(Buffer.from('clientes.csv'))).toBe(true);

  // Prima di eliminare la fioreria, la pagina ricorda di scaricarli.
  await page.goto(`/app/${slug}/settings/delete`);
  await expect(page.getByTestId('delete-export-hint')).toContainText(
    'descarga los datos de tu florería',
  );
});

test.describe('chi non è titolare', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('non vede la card e la rotta risponde 404', async ({ page, request }) => {
    await page.goto('/app/las-camelias/settings');
    await expect(page.getByTestId('export-data')).toHaveCount(0);
    const response = await request.get('/app/las-camelias/settings/export');
    expect(response.status()).toBe(404);
  });
});
