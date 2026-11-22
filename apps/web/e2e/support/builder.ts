import { expect, type Page } from '@playwright/test';

/**
 * Compone e salva un disegno semplice nel Diseñador a passi (fiori → follaje y empaque con carta
 * kraft → nome) e si ferma sul passo successivo al salvataggio (l'anteprima, se c'è l'AI).
 */
export async function saveSimpleDesign(
  page: Page,
  input: { readonly name: string; readonly flower: string; readonly quantity: number },
): Promise<void> {
  await page.goto('/app/las-camelias/builder/new');
  await page
    .getByRole('spinbutton', { name: `Cantidad de ${input.flower}` })
    .fill(String(input.quantity));
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('radio', { name: /Papel coreano kraft/ }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('textbox', { name: 'Nombre del diseño' }).fill(input.name);
  await page.getByRole('button', { name: 'Guardar diseño' }).click();
  await expect(page).toHaveURL(/\/builder\/[0-9a-f-]{36}\?saved=1$/);
}
