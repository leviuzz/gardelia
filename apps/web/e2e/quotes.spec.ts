import { expect, test, type Page } from '@playwright/test';

function catalogForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
}

function customLineForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('textbox', { name: 'Concepto' }) });
}

test.describe('cotizaciones (propietario)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('dal cliente al preventivo inviato, con totali calcolati sul server', async ({ page }) => {
    await page.goto('/app/las-camelias/customers');
    await page.getByRole('link', { name: /Hotel Casa Fuentes/ }).click();
    await page.getByRole('link', { name: 'Nueva cotización' }).click();
    await expect(page.getByText('Cotización para Hotel Casa Fuentes')).toBeVisible();
    await page.getByRole('button', { name: 'Crear cotización' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('COT-');

    // Riga dal catalogo: prezzo e distinta arrivano dal server.
    const addForm = catalogForm(page);
    await addForm
      .getByRole('combobox', { name: 'Producto' })
      .selectOption({ label: 'Ramo Clásico 12 rosas — $690.00 por pieza' });
    await addForm.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('2');
    await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByText('Concepto agregado')).toBeVisible();
    await expect(page.getByTestId('quote-total')).toHaveText('$1,380.00');
    await expect(page.getByText(/Incluye: 12 × Rosa roja/)).toBeVisible();

    // Riga libera con prezzo del fiorista.
    await page.getByRole('button', { name: 'Agregar concepto libre' }).click();
    const custom = customLineForm(page);
    await custom.getByRole('textbox', { name: 'Concepto' }).fill('Envío a domicilio');
    await custom.getByRole('textbox', { name: 'Precio unitario (MXN)' }).fill('150');
    await custom.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByTestId('quote-total')).toHaveText('$1,530.00');

    // Lo sconto non può superare il subtotale (verifica lato server).
    const discount = page.getByRole('textbox', { name: 'Descuento (MXN)' });
    await discount.fill('5000');
    await page.getByRole('button', { name: 'Guardar detalles' }).click();
    await expect(page.getByText('El descuento no puede ser mayor que el subtotal.')).toBeVisible();
    await discount.fill('30');
    await page.getByRole('button', { name: 'Guardar detalles' }).click();
    await expect(page.getByTestId('quote-total')).toHaveText('$1,500.00');

    // Una volta inviata non si modifica più e si può condividere via WhatsApp.
    await page.getByRole('button', { name: 'Marcar como enviada' }).click();
    await expect(page.getByText('Estado actualizado: Enviada')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Producto' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Volver a borrador' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Enviar por WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/524495550177\?text=/,
    );

    // Il preventivo compare nell'elenco e nella scheda cliente.
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /COT-\d+/,
    )?.[0];
    expect(number).toBeTruthy();
    await page.goto(`/app/las-camelias/quotes?q=${number}`);
    await expect(page.getByRole('link', { name: new RegExp(number!) })).toContainText('$1,500.00');
  });

  test('un preventivo vuoto non si può inviare', async ({ page }) => {
    await page.goto('/app/las-camelias/quotes/new?q=Mar%C3%ADa');
    await page.getByRole('button', { name: 'Cotización para María Fernanda López' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Marcar como enviada' }).click();
    await expect(page.getByText('Agrega al menos un concepto antes de enviarla.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar cotización' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar cotización' }).click();
    await expect(page.getByText('Estado actualizado: Cancelada')).toBeVisible();
  });
});

test.describe('cotizaciones (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff consulta i preventivi ma non li crea', async ({ page }) => {
    await page.goto('/app/las-camelias/quotes');
    await expect(page.getByRole('heading', { name: 'Cotizaciones' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nueva cotización' })).toBeHidden();
    await page.goto('/app/las-camelias/quotes/new');
    await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
  });
});
