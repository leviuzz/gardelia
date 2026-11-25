import { expect, test } from '@playwright/test';
import {
  SHOP,
  addSlot,
  archiveSlot,
  dayInShop,
  expectFitsAt320,
  saveOffer,
} from './support/floral-care';

/**
 * Floral Care, «Nuevo contrato» dall'elenco dei contratti (25/11, il founder girava in tondo fra
 * Clientes e Floral Care): senza offerta pronta si vedono i due passi che mancano, con il link ad
 * Ajustes; con l'offerta pronta si sceglie il cliente e si apre il suo modulo.
 */
test.describe('Floral Care: nuevo contrato desde la lista', () => {
  test.describe('una florería sin oferta', () => {
    test.use({ storageState: 'e2e/.auth/other-owner.json' });

    test('vede i passi che mancano, anche dopo «Nuevo contrato»', async ({ page }) => {
      await page.goto('/app/flores-del-valle/subscriptions');
      const setup = page.getByTestId('care-setup');
      await expect(setup.getByText('Antes del primer contrato')).toBeVisible();
      await expect(setup.getByText('Pendiente')).toHaveCount(2);
      // Senza contratti il pulsante c'è anche nel riquadro vuoto: basta il primo.
      await page.getByRole('link', { name: 'Nuevo contrato' }).first().click();
      await expect(page).toHaveURL(/\/subscriptions\/new$/);
      // Nessun elenco di clienti finché l'offerta non è pronta: solo i passi e il link.
      await expect(page.getByTestId('care-pick-customer')).toHaveCount(0);
      await expect(page.getByTestId('care-setup')).toBeVisible();
      await expectFitsAt320(page, 'care-setup');
      await page.getByRole('link', { name: 'Ir a Ajustes → Floral Care' }).click();
      await expect(page).toHaveURL(/\/settings\/floral-care$/);
    });
  });

  test.describe('la florería con la oferta lista', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('«Nuevo contrato» → cerca il cliente → il suo modulo', async ({ page }) => {
      const stamp = Date.now();
      const tomorrow = dayInShop(1);
      await saveOffer(page, '24');
      const slot = await addSlot(page, tomorrow, 0);

      // Un cliente nuovo, senza indirizzo.
      const name = `Despacho Nuevo ${stamp}`;
      await page.goto(`${SHOP}/customers/new`);
      await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
      await page.getByRole('button', { name: 'Crear cliente' }).click();
      await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);

      // Dall'elenco dei contratti, senza passare da Clientes.
      await page.goto(`${SHOP}/subscriptions`);
      await expect(page.getByTestId('care-setup')).toHaveCount(0);
      await page.getByRole('link', { name: 'Nuevo contrato' }).first().click();
      const picker = page.getByTestId('care-pick-customer');
      await expect(picker.getByText('¿Para qué cliente es?', { exact: false })).toBeVisible();
      await picker.getByRole('searchbox').fill(name);
      await picker.getByRole('button', { name: 'Buscar', exact: true }).click();
      await picker.getByRole('button', { name: `Contrato para ${name}` }).click();
      await expect(page).toHaveURL(/\/subscriptions\/new\?customer=[0-9a-f-]{36}$/);
      await expect(page.getByText(`Para ${name}.`, { exact: false })).toBeVisible();
      // Il cliente non ha ancora l'indirizzo delle piante: lo dice e porta alla sua scheda.
      await expect(page.getByText('El cliente no tiene direcciones')).toBeVisible();
      await expectFitsAt320(page, 'care-new-contract');

      await archiveSlot(page, slot.label);
    });
  });
});
