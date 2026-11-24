import { expect, test, type Page } from '@playwright/test';
import { createProduct } from './support/catalog';
import { pickOrderCustomer } from './support/customers';
import { runSystemSql } from './support/sql';

/**
 * Catalogo e approvvigionamento (ADR-081): il proveedor habitual di un prodotto e "Por pedir" con
 * il messaggio di WhatsApp pronto; un servizio con durata e raggio nella riga del pedido; il
 * sostituto quando un fiore di un ramo si esaurisce, con l'ok del cliente.
 */

const SHOP = '/app/las-camelias';

test.use({ storageState: 'e2e/.auth/owner.json' });

/** Un pedido da ritirare per Hotel Casa Fuentes con un prodotto (etichetta della tendina). */
async function orderWith(page: Page, optionLabel: string, quantity = '1'): Promise<void> {
  await page.goto(`${SHOP}/orders/new`);
  await pickOrderCustomer(page, 'Hotel Casa Fuentes');
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const addForm = page
    .locator('form')
    .filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
  await addForm.getByRole('combobox', { name: 'Producto' }).selectOption({ label: optionLabel });
  await addForm.getByLabel('Cantidad').fill(quantity);
  await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Concepto agregado')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar' }).click();
  await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByText('Pedido confirmado.')).toBeVisible();
}

test('proveedor habitual y "Por pedir" con el mensaje de WhatsApp', async ({ page }) => {
  const stamp = Date.now();
  const supplier = `Mercado E2E ${stamp}`;
  const flower = `Lisianthus E2E ${stamp}`;

  await page.goto(`${SHOP}/inventory/suppliers`);
  await page
    .getByRole('textbox', { name: /^Nombre/ })
    .first()
    .fill(supplier);
  await page.getByLabel('Teléfono (opcional)').first().fill('449 555 0188');
  await page.getByRole('button', { name: 'Agregar proveedor' }).click();
  await expect(page.getByText('Proveedor agregado.')).toBeVisible();

  // Il prodotto con il suo proveedor habitual, poi controllato con poca merce.
  await page.goto(`${SHOP}/catalog/new`);
  await createProduct(page, { name: flower, price: '28', colors: ['Morado'] });
  await page.getByRole('link', { name: 'Saltar por ahora' }).click();
  await page.getByRole('link', { name: 'Ver el producto' }).click();
  await page.getByLabel('Proveedor habitual').selectOption({ label: supplier });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await expect(page.getByLabel('Proveedor habitual')).toHaveValue(/[0-9a-f-]{36}/);

  await page.getByRole('link', { name: 'Controlar existencias' }).click();
  await page.getByLabel('Tienes hoy (tallos)').first().fill('2');
  await page.getByLabel('Avísame con').first().fill('20');
  await page.getByRole('button', { name: 'Empezar a controlar' }).click();
  await expect(page.getByText('Listo: ahora controlas 1 producto.')).toBeVisible();

  await page.goto(`${SHOP}/inventory`);
  await page.getByRole('link', { name: 'Por pedir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Por pedir' })).toBeVisible();
  const group = page.getByTestId('restock-group').filter({ hasText: supplier });
  await expect(group.getByRole('link', { name: flower })).toBeVisible();
  await expect(group.getByText('Quedan 2 tallos')).toBeVisible();
  const whatsapp = group.getByRole('link', { name: 'Pedir por WhatsApp' });
  const href = decodeURIComponent((await whatsapp.getAttribute('href')) ?? '');
  expect(href).toContain('https://wa.me/524495550188');
  expect(href).toContain(`Hola ${supplier}`);
  expect(href).toContain(`• ${flower}`);

  // "Registrar compra" arriva con il proveedor e il prodotto già scelti.
  await group.getByRole('link', { name: 'Registrar compra' }).click();
  await expect(page.getByLabel('Proveedor', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByRole('combobox', { name: 'Producto' }).first()).toHaveValue(
    /[0-9a-f-]{36}/,
  );
});

test('un servicio con duración y zona aparece en la línea del pedido', async ({ page }) => {
  const service = `Montaje E2E ${Date.now()}`;
  await page.goto(`${SHOP}/catalog/new`);
  await page.getByLabel('Tipo de producto').selectOption('SERVICE');
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(service);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Precio de venta (MXN)').fill('1500');
  await page.getByLabel('Duración del servicio').selectOption({ label: '3 h' });
  await page.getByLabel('Hasta cuántos km lo haces').fill('15');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  // I servizi non hanno foto: si arriva subito a "Listo".
  await expect(
    page.getByRole('heading', { name: new RegExp(`${service}.*ya está`) }),
  ).toBeVisible();

  await orderWith(page, `${service} — $1,500.00 por servicio`);
  await expect(page.getByText('Duración aprox. 3 h · Hasta 15 km').first()).toBeVisible();
});

test('falta una flor del ramo: se propone una parecida y se cambia con el ok del cliente', async ({
  page,
}) => {
  const stamp = Date.now();
  const original = `Rosa sust A ${stamp}`;
  const substitute = `Rosa sust B ${stamp}`;
  const bouquet = `Ramo sust ${stamp}`;
  // Un prezzo insolito: fra le rose di prova il sostituto più vicino è proprio quello.
  for (const name of [original, substitute]) {
    await page.goto(`${SHOP}/catalog/new`);
    await createProduct(page, { name, price: '47.50', colors: ['Rojo'] });
  }
  await page.goto(`${SHOP}/catalog/new`);
  await createProduct(page, { type: 'BOUQUET', name: bouquet, price: '600' });
  await page.getByRole('link', { name: 'Saltar por ahora' }).click();
  await page.getByRole('link', { name: 'Armar la receta' }).click();
  await page.getByLabel('Ingrediente', { exact: true }).selectOption({ label: original });
  await page.getByLabel('Cantidad', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Agregar ingrediente' }).click();
  await expect(page.getByText('Ingrediente agregado')).toBeVisible();

  await orderWith(page, `${bouquet} — $600.00 por pieza`);
  const total = await page.getByTestId('order-total').textContent();
  await expect(page.getByTestId('order-substitutions')).toHaveCount(0);

  // La rosa si esaurisce dopo la conferma (come dal catalogo, qui senza passare dalla scheda).
  runSystemSql(
    `UPDATE "CatalogItem" SET "availability" = 'OUT_OF_STOCK' WHERE "name" = '${original}';`,
  );
  await page.reload();
  const panel = page.getByTestId('order-substitutions');
  await expect(panel.getByRole('heading', { name: 'Faltan flores' })).toBeVisible();
  await expect(panel.getByText('Pregunta al cliente antes')).toBeVisible();
  await expect(panel.getByText('Agotado en el catálogo')).toBeVisible();
  const option = panel.locator('label').filter({ hasText: substitute });
  // Stessa specie (suggerita dal nome) o almeno lo stesso colore.
  await expect(option.getByText(/Misma flor|Mismo color/)).toBeVisible();
  await option.getByRole('radio').check();

  // Senza l'ok del cliente non si cambia.
  await panel.getByRole('button', { name: 'Cambiar flor' }).click();
  await expect(panel.getByText('Confirma que el cliente aceptó el cambio.')).toBeVisible();
  await panel.getByRole('checkbox', { name: 'El cliente aceptó el cambio' }).check();
  await panel.getByRole('button', { name: 'Cambiar flor' }).click();
  await expect(page.getByText('Flor cambiada en el ramo')).toBeVisible();

  await expect(page.getByTestId('order-substitutions')).toHaveCount(0);
  await expect(page.getByText(`6 × ${substitute} (en lugar de ${original})`).first()).toBeVisible();
  await expect(page.getByTestId('order-total')).toHaveText(total ?? '');
});
