import { expect, type Page } from '@playwright/test';

/**
 * Crea un prodotto con la procedura guidata (cosa è → colori → prezzo) partendo dalla pagina
 * "Nuevo producto"; si ferma sul passo della foto, con la conferma "Producto creado".
 */
export async function createProduct(
  page: Page,
  input: {
    readonly name: string;
    readonly price: string;
    readonly cost?: string;
    readonly type?: string;
    readonly colors?: readonly string[];
  },
): Promise<void> {
  if (input.type) await page.getByLabel('Tipo de producto').selectOption(input.type);
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(input.name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  for (const color of input.colors ?? []) await page.getByText(color, { exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Precio de venta (MXN)').fill(input.price);
  if (input.cost) await page.getByLabel('Costo estimado (MXN)').fill(input.cost);
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByText('Producto creado')).toBeVisible();
}
