import { expect, test } from '@playwright/test';

/**
 * Impostazioni di consegna (ADR-055) nella seconda fioreria demo, così le fasce non cambiano i
 * form degli altri test: fasce come scelte rapide, avviso del giorno di chiusura, costo proposto.
 */
test.describe('ajustes de entrega (propietario)', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('franjas, día cerrado y costo habitual llegan al pedido', async ({ page }) => {
    await page.goto('/app/flores-del-valle/settings');
    await expect(page.getByRole('heading', { name: 'Entregas' })).toBeVisible();

    // Idempotente: se la fascia c'è già (esecuzioni precedenti) si toglie e si rimette.
    const existing = page.getByRole('button', { name: 'Quitar la franja 09:00 a 12:00' });
    if ((await existing.count()) > 0) {
      await existing.click();
      await expect(page.getByText('Franja quitada.')).toBeVisible();
    }
    await page.getByLabel('Desde').fill('12:00');
    await page.getByLabel('Hasta').fill('11:00');
    await page.getByRole('button', { name: 'Agregar franja' }).click();
    // L'errore sotto il campo (niente toast doppio: lo controlla errors.spec.ts con la CPU lenta).
    await expect(page.locator('#window-end-error')).toHaveText(
      'Indica la hora de inicio y la de fin, en orden.',
    );
    await page.getByLabel('Desde').fill('09:00');
    await page.getByLabel('Hasta').fill('12:00');
    await page.getByRole('button', { name: 'Agregar franja' }).click();
    await expect(page.getByText('Franja agregada.')).toBeVisible();
    await expect(page.getByText('09:00 a 12:00')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Domingo' }).check();
    await page.getByRole('textbox', { name: 'Costo de envío habitual (MXN)' }).fill('80');
    await page
      .locator('form')
      .filter({ has: page.getByRole('checkbox', { name: 'Domingo' }) })
      .getByRole('button', { name: 'Guardar' })
      .click();
    await expect(page.getByText('Ajustes de entrega guardados.')).toBeVisible();

    // Un pedido nuovo propone fasce e costo, e avvisa se il giorno è di chiusura.
    await page.goto('/app/flores-del-valle/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(`Entregas ${Date.now()}`);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    await page.getByRole('link', { name: 'Nuevo pedido' }).click();
    await page.getByRole('button', { name: 'Crear pedido' }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);

    await page.getByRole('button', { name: 'Agregar concepto libre' }).click();
    await page.getByRole('textbox', { name: 'Concepto' }).fill('Arreglo de mesa');
    await page.getByRole('textbox', { name: 'Precio unitario (MXN)' }).fill('500');
    await page
      .locator('form')
      .filter({ has: page.getByRole('textbox', { name: 'Concepto' }) })
      .getByRole('button', { name: 'Agregar', exact: true })
      .click();
    await expect(page.getByTestId('order-total')).toHaveText('$500.00');
    // Nuevo pedido a passi: dai prodotti si continua alla consegna.
    await page.getByRole('link', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\?step=delivery$/);

    await expect(page.getByRole('textbox', { name: 'Costo de envío (MXN)' })).toHaveValue('80.00');
    await expect(page.getByLabel('Desde')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Otro horario' }).check();
    await expect(page.getByLabel('Desde')).toBeVisible();
    await page.getByRole('radio', { name: '09:00 a 12:00' }).check();
    await expect(page.getByLabel('Desde')).toHaveCount(0);

    // Una domenica fra 1 e 2 settimane: c'è l'avviso, ma si può confermare.
    const sunday = new Date();
    sunday.setUTCDate(sunday.getUTCDate() + 7 + ((7 - sunday.getUTCDay()) % 7));
    await page.getByLabel('Fecha').fill(sunday.toISOString().slice(0, 10));
    await expect(page.getByText('Según tus ajustes, la florería no abre ese día.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Calle y número' }).fill('Av. Convención 302');
    await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
    await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByText('Pedido confirmado.')).toBeVisible();
    await expect(page.getByTestId('order-total')).toHaveText('$580.00');
    await expect(page.getByText('09:00 a 12:00').first()).toBeVisible();
  });
});
