import { expect, test } from '@playwright/test';

/**
 * Clienti con le loro date speciali (compleanni, anniversari, altre date) inserite già nel
 * modulo "Nuevo cliente": si salvano insieme al cliente, con gli errori sulla riga giusta.
 * Cronologia (CRM-01): il preventivo creato dalla scheda compare nell'"Historial" col suo link.
 */
test.describe('nuovo cliente con date speciali', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('si aggiungono le date nel modulo; un errore resta sulla sua riga', async ({ page }) => {
    const name = `Cliente con fechas ${Date.now()}`;
    await page.goto('/app/las-camelias/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await expect(page.getByText('Sin fechas registradas.')).toBeVisible();

    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const first = page.getByRole('group', { name: 'Fecha 1' });
    await first.getByRole('spinbutton', { name: 'Día', exact: true }).fill('14');
    await first
      .getByRole('combobox', { name: 'Mes', exact: true })
      .selectOption({ label: 'diciembre' });
    await first.getByLabel('Año (opcional)').fill('1990');

    // Seconda data personalizzata senza nome: il server la rifiuta e lo dice su quella riga.
    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const second = page.getByRole('group', { name: 'Fecha 2' });
    await second
      .getByRole('combobox', { name: 'Tipo', exact: true })
      .selectOption({ label: 'Otra fecha' });
    await second.getByRole('spinbutton', { name: 'Día', exact: true }).fill('21');
    await second
      .getByRole('combobox', { name: 'Mes', exact: true })
      .selectOption({ label: 'junio' });
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(second.getByText('Este campo es obligatorio.')).toBeVisible();
    await expect(first.getByRole('spinbutton', { name: 'Día', exact: true })).toHaveValue('14');

    await second.getByRole('textbox', { name: 'Nombre de la fecha' }).fill('Día del padre');
    await second.getByLabel('¿De quién es?').fill('Su papá');
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByText('14 de diciembre de 1990')).toBeVisible();
    await expect(page.getByText('Día del padre')).toBeVisible();
    await expect(page.getByText('de Su papá')).toBeVisible();
  });
});

test.describe('cronologia del cliente', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il preventivo creato dalla scheda compare nell’historial, col suo link', async ({
    page,
  }) => {
    // "Zoila …": in fondo alle liste per nome, così non sposta i clienti del seed usati da altri test.
    const name = `Zoila Historial ${Date.now()}`;
    await page.goto('/app/las-camelias/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    const customerUrl = page.url().replace(/\?.*$/, '');
    const history = page.getByRole('region', { name: 'Historial' });
    await expect(history.getByText('Cliente registrado')).toBeVisible();

    await page.getByRole('link', { name: 'Nueva cotización' }).click();
    await page.getByRole('button', { name: 'Crear cotización' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    const heading = await page.getByRole('heading', { level: 1 }).textContent();
    const number = /COT-\d+/.exec(heading ?? '')?.[0];
    expect(number).toBeTruthy();

    await page.goto(customerUrl);
    const created = history.getByRole('link', { name: `Cotización ${number} creada` });
    await expect(created).toBeVisible();
    await created.click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number ?? 'COT-');
  });
});
