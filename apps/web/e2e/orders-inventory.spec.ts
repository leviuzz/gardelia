import { expect, test } from '@playwright/test';
import { createProduct } from './support/catalog';

/**
 * Scarico dell'inventario dagli ordini (ADR-071): la scheda dell'ordine dice cosa uscirà
 * dall'inventario e cosa manca; "Listo" con la merce che non basta chiede di confermarlo nel
 * pulsante stesso, poi scarica una volta sola con il numero dell'ordine nei movimenti.
 */

const SHOP = '/app/las-camelias';
const name = `Rosa pedido ${Date.now()}`;

test.use({ storageState: 'e2e/.auth/owner.json' });

test('"Listo" scarica i materiali dell\'ordine, con la conferma se non bastano', async ({
  page,
}) => {
  // Un fiore nuovo, controllato con 5 tallos.
  await page.goto(`${SHOP}/catalog/new`);
  await createProduct(page, { name, price: '35', cost: '14', colors: ['Rojo'] });
  await page.getByRole('link', { name: 'Saltar por ahora' }).click();
  await page.getByRole('link', { name: 'Ver el producto' }).click();
  await page.getByRole('link', { name: 'Controlar existencias' }).click();
  await page.getByLabel('Tienes hoy (tallos)').first().fill('5');
  await page.getByRole('button', { name: 'Empezar a controlar' }).click();
  await expect(page.getByText('Listo: ahora controlas 1 producto.')).toBeVisible();

  // Un ordine con 8 tallos di quel fiore, da ritirare in negozio.
  await page.goto(`${SHOP}/orders/new`);
  await page.getByRole('button', { name: 'Pedido para Hotel Casa Fuentes' }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const addForm = page
    .locator('form')
    .filter({ has: page.getByRole('combobox', { name: 'Producto' }) });
  await addForm
    .getByRole('combobox', { name: 'Producto' })
    .selectOption({ label: `${name} — $35.00 por tallo` });
  await addForm.getByLabel('Cantidad').fill('8');
  await addForm.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByTestId('order-total')).toHaveText('$280.00');
  await page.getByRole('link', { name: 'Continuar' }).click();
  await page.getByRole('radio', { name: 'Recoge en tienda' }).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByText('Pedido confirmado.')).toBeVisible();
  const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
    /PED-\d+/,
  )?.[0];
  expect(number).toBeTruthy();

  // Prima di "Listo": cosa uscirà e cosa manca.
  const inventory = page.getByTestId('order-inventory');
  await expect(
    inventory.getByText('Al marcarlo como listo, estos materiales se descuentan del inventario.'),
  ).toBeVisible();
  await expect(inventory.getByRole('listitem').filter({ hasText: name })).toContainText('8 tallos');
  await expect(inventory.getByText('Faltan 3 tallos')).toBeVisible();

  await page.getByRole('button', { name: 'Empezar a preparar' }).click();
  await expect(page.getByText('Pedido marcado como «En preparación»')).toBeVisible();
  const shortage = page.getByTestId('order-shortage');
  await expect(shortage).toContainText(`${name}: faltan 3 tallos`);
  await page.getByRole('button', { name: 'Marcar listo aunque falte' }).click();
  await expect(page.getByText('Pedido marcado como «Listo»')).toBeVisible();
  await expect(inventory.getByText(/se descontaron los materiales del inventario\./)).toBeVisible();
  await expect(shortage).toHaveCount(0);

  // Nei movimenti: un uso con il numero dell'ordine; la giacenza è sotto zero.
  await inventory.getByRole('link', { name: 'Ver movimientos del inventario' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inventario' })).toBeVisible();
  await expect(page.getByText(number!).first()).toBeVisible();
  await page.goto(`${SHOP}/inventory?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByText(/-3 tallos|−3 tallos/).first()).toBeVisible();
});
