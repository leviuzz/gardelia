import { expect, test } from '@playwright/test';
import { pickOrderCustomer } from './support/customers';

/** Ruta del día e repartidor (ADR-058). */
test.describe('ruta del día (propietaria)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('si assegna il repartidor, che vede la sua fermata e la porta avanti', async ({
    page,
    browser,
  }) => {
    // Un giorno lontano e casuale, per non mescolarsi con altri test.
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
    await page.getByLabel('Fecha').fill(iso);
    const newAddress = page.getByRole('radio', { name: 'Otra dirección' });
    if ((await newAddress.count()) > 0) await newAddress.check();
    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Convención 302');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('textbox', { name: 'Nombre de quien recibe' }).fill('Recepción');
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByText('Pedido confirmado.')).toBeVisible();
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /PED-\d+/,
    )?.[0];
    expect(number).toBeTruthy();

    await page.getByRole('combobox', { name: 'Repartidor' }).selectOption({ label: 'Ana Torres' });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Repartidor actualizado.')).toBeVisible();

    await page.goto(`/app/las-camelias/orders/route?date=${iso}`);
    const stop = page.getByRole('article').filter({ hasText: number ?? 'PED' });
    await expect(stop.getByText('Av. Convención 302')).toBeVisible();
    await expect(stop.getByText('Ana Torres')).toBeVisible();
    await expect(stop.getByText(/Cobrar \$/)).toBeVisible();
    await expect(stop.getByRole('link', { name: 'Ir' })).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Av\.%20Convenci/,
    );
    await expect(page.getByRole('link', { name: /Google Maps/ }).first()).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/dir\/\?/,
    );

    // Il repartidor (banco) la trova in "Mis entregas" e la fa avanzare.
    const staffContext = await browser.newContext({ storageState: 'e2e/.auth/staff.json' });
    const staff = await staffContext.newPage();
    await staff.goto(`/app/las-camelias/orders/route?date=${iso}&mine=1`);
    const mine = staff.getByRole('article').filter({ hasText: number ?? 'PED' });
    await expect(mine).toBeVisible();
    await expect(staff.getByRole('combobox', { name: 'Repartidor' })).toHaveCount(0);
    await mine.getByRole('button', { name: 'Empezar a preparar' }).click();
    await expect(staff.getByText('Pedido marcado como «En preparación»')).toBeVisible();
    await staffContext.close();
  });
});
