import { expect, test } from '@playwright/test';
import { pickOrderCustomer } from './support/customers';

/** Agenda dei pedidos (ADR-057): giorno per fascia con passi rapidi, produzione e mese. */
test.describe('agenda de pedidos (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il pedido appare nel giorno, in produzione e nel mese', async ({ page }) => {
    // Un giorno lontano e casuale: le esecuzioni precedenti non si sommano (quasi mai).
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 100 + Math.floor(Math.random() * 200));
    const iso = date.toISOString().slice(0, 10);

    await page.goto('/app/las-camelias/orders/new');
    await pickOrderCustomer(page, 'Hotel Casa Fuentes');
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const addForm = page
      .locator('form')
      .filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
    await addForm
      .getByRole('combobox', { name: 'Producto' })
      .selectOption({ label: 'Ramo Clásico 12 rosas — $690.00 por pieza' });
    await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByTestId('order-total')).toHaveText('$690.00');
    // Nuevo pedido a passi: dai prodotti si continua alla consegna.
    await page.getByRole('link', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\?step=delivery$/);
    await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
    await page.getByLabel('Fecha').fill(iso);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByText('Pedido confirmado.')).toBeVisible();
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /PED-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    await page.goto(`/app/las-camelias/orders/day?date=${iso}`);
    await expect(page.getByRole('navigation', { name: 'Vistas de pedidos' })).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: number ?? 'PED' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Por cobrar $690.00')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Durante el día' })).toBeVisible();
    const production = page.getByRole('table', { name: 'Flores y materiales necesarios' });
    await expect(production.getByRole('row', { name: /Rosa roja Freedom/ })).toContainText(
      'tallos',
    );

    await card.getByRole('button', { name: 'Empezar a preparar' }).click();
    await expect(page.getByText('Pedido marcado como «En preparación»')).toBeVisible();
    await expect(card.getByText('En preparación')).toBeVisible();

    await page.getByRole('link', { name: 'Imprimir', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Producción del día' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Rosa roja Freedom/ })).toBeVisible();

    await page.goto(`/app/las-camelias/orders/calendar?month=${iso.slice(0, 7)}`);
    const dayLink = page.locator(`a[href$="/orders/day?date=${iso}"]`);
    await expect(dayLink).toHaveAttribute('aria-label', /en tienda/);
    await dayLink.click();
    await expect(page).toHaveURL(new RegExp(`/orders/day\\?date=${iso}$`));
  });
});

test.describe('agenda de pedidos (banco)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('il banco vede il giorno e fa avanzare i pedidos, ma non ne crea', async ({ page }) => {
    await page.goto('/app/las-camelias/orders/day');
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy salen' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo pedido' })).toHaveCount(0);
  });
});
