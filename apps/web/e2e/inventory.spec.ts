import { expect, test, type Page } from '@playwright/test';
import { createProduct } from './support/catalog';

/**
 * Inventario (ADR-060): si comincia a controllare un fiore dalla sua scheda del catalogo, si
 * registrano uso, merma (con la conferma quando non basta), conteggio e un'anulación; il clic
 * proposto cambia la disponibilità nel catalogo. Lo staff vede le quantità senza costi né azioni;
 * una fioreria senza Plus vede l'invito all'upgrade.
 */

const SHOP = '/app/las-camelias';
const name = `Rosa inventario ${Date.now()}`;

async function openItem(page: Page): Promise<void> {
  await page.goto(`${SHOP}/inventory?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test.describe.serial('inventario', () => {
  test.describe('proprietario', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('comincia a controllare un fiore e registra i movimenti del giorno', async ({ page }) => {
      await page.goto(`${SHOP}/catalog/new`);
      await createProduct(page, { name, price: '35', cost: '14', colors: ['Rojo'] });
      await page.getByRole('link', { name: 'Saltar por ahora' }).click();
      await page.getByRole('link', { name: 'Ver el producto' }).click();

      // Dalla scheda del catalogo: il prodotto non si controlla ancora.
      await expect(page.getByText('No controlas las existencias de este producto.')).toBeVisible();
      await page.getByRole('link', { name: 'Controlar existencias' }).click();
      await expect(page.getByRole('heading', { name: 'Elegir productos' })).toBeVisible();

      // Senza nessuna quantità il form lo dice, senza perdere il minimo scritto.
      await page.getByLabel('Avísame con').first().fill('40');
      await page.getByRole('button', { name: 'Empezar a controlar' }).click();
      await expect(page.getByText('Escribe cuántos tienes de al menos un producto.')).toBeVisible();
      await expect(page.getByLabel('Avísame con').first()).toHaveValue('40');
      await page.getByLabel('Tienes hoy (tallos)').first().fill('50');
      await page.getByRole('button', { name: 'Empezar a controlar' }).click();
      await expect(page).toHaveURL(/\/inventory\?started=1$/);
      await expect(page.getByText('Listo: ahora controlas 1 producto.')).toBeVisible();

      await openItem(page);
      await expect(page.getByText('50 tallos').first()).toBeVisible();
      await expect(page.getByText('Existencia inicial')).toBeVisible();

      // Uso: 38 restano, al minimo (40) → "Por agotarse" e il clic proposto per il catalogo.
      await page.getByRole('button', { name: 'Registrar uso' }).click();
      const useDialog = page.getByRole('dialog');
      await useDialog.getByLabel('Cantidad (tallos)').fill('12');
      await useDialog.getByLabel('Nota (opcional)').fill('Ramo de novia');
      await useDialog.getByRole('button', { name: 'Registrar', exact: true }).click();
      await expect(page.getByText('Uso registrado: quedan 38 tallos.')).toBeVisible();
      await expect(page.getByText('Por agotarse').first()).toBeVisible();
      await expect(page.getByText('Ramo de novia', { exact: true })).toBeVisible();

      await expect(
        page.getByText('Quedan pocos: ¿marcarlo como limitado en el catálogo?'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Marcar como limitado' }).click();
      await expect(page.getByText('Listo: el catálogo ya muestra el cambio.')).toBeVisible();

      // Merma più grande della giacenza: avviso, poi "Registrar de todos modos".
      await page.getByRole('button', { name: 'Registrar merma' }).click();
      const wasteDialog = page.getByRole('dialog');
      await wasteDialog.getByLabel('Cantidad (tallos)').fill('40');
      await expect(
        wasteDialog.getByText(
          'Solo tienes 38 tallos. Si continúas, las existencias quedarán en -2 tallos.',
        ),
      ).toBeVisible();
      await wasteDialog.getByRole('button', { name: 'Registrar de todos modos' }).click();
      await expect(page.getByText('Merma registrada: quedan -2 tallos.')).toBeVisible();
      await expect(page.getByText(/Faltan 2 tallos/)).toBeVisible();

      // Conteggio: la differenza diventa un ajuste.
      await page.getByRole('button', { name: 'Contar' }).click();
      const countDialog = page.getByRole('dialog');
      await countDialog.getByLabel('Cuántos hay (tallos)').fill('10');
      await countDialog.getByRole('button', { name: 'Guardar conteo' }).click();
      await expect(page.getByText('Conteo guardado: ahora tienes 10 tallos.')).toBeVisible();

      // Anular la merma: un movimento opposto, niente cancellato.
      const wasteRow = page.getByRole('listitem').filter({ hasText: 'Merma' }).first();
      await wasteRow.getByRole('button', { name: 'Anular' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Anular movimiento' }).click();
      await expect(page.getByText('Movimiento anulado.')).toBeVisible();
      await expect(page.getByText('Anula: Merma')).toBeVisible();
      await expect(page.getByText('50 tallos').first()).toBeVisible();

      // L'elenco dei movimenti li mostra tutti, con il link al prodotto.
      await page.goto(`${SHOP}/inventory/movements`);
      await expect(page.getByRole('link', { name }).first()).toBeVisible();
      await page.getByRole('link', { name: 'Existencias' }).click();
      await expect(page).toHaveURL(/\/inventory$/);
    });
  });

  test.describe('staff', () => {
    test.use({ storageState: 'e2e/.auth/staff.json' });

    test('vede le quantità, senza costi né azioni', async ({ page }) => {
      await openItem(page);
      await expect(page.getByText('50 tallos').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Registrar uso' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);
      await expect(page.getByText('Valor de la mercancía')).toHaveCount(0);
      await page.goto(`${SHOP}/inventory/start`);
      await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
    });
  });

  test.describe('fioreria senza Plus', () => {
    test.use({ storageState: 'e2e/.auth/other-owner.json' });

    test('l’inventario propone l’upgrade, senza funzioni finte', async ({ page }) => {
      await page.goto('/app/flores-del-valle/inventory');
      await expect(page.getByText('El inventario está incluido en Gardelia Plus')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Registrar uso' })).toHaveCount(0);
      await page.goto('/app/flores-del-valle/settings/plan');
      const inventory = page.getByRole('listitem').filter({ hasText: 'Inventario' });
      await expect(inventory.getByText('Disponible en Plus')).toBeVisible();
    });
  });
});
