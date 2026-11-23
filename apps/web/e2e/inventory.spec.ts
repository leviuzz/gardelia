import { expect, test, type Page } from '@playwright/test';
import { createProduct } from './support/catalog';

/**
 * Inventario (ADR-060): si comincia a controllare un fiore dalla sua scheda del catalogo, si
 * registrano uso, merma (con la conferma quando non basta), conteggio e un'anulación; il clic
 * proposto cambia la disponibilità nel catalogo. Lo staff vede le quantità senza costi né azioni;
 * una fioreria senza Plus vede l'invito all'upgrade. Apartados (ADR-062): la merce apartada esce
 * dal disponibile, "Usar" scarica quanto si è usato davvero, "Liberar" la restituisce. Ramos
 * (ADR-063): quanti se ne possono fare, "Registrar ramos hechos", avvisi nel pannello e riepilogo.
 */

const SHOP = '/app/las-camelias';
const name = `Rosa inventario ${Date.now()}`;

/** Giorno "AAAA-MM-GG" a `days` giorni da oggi, nel calendario della fioreria (Città del Messico). */
function shopDate(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
    new Date(),
  );
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

  test.describe('compras (proprietario)', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('una compra con proveedor nuovo aggiorna giacenza e costo reale; si annulla', async ({
      page,
    }) => {
      const supplier = `Mercado E2E ${Date.now()}`;
      await page.goto(`${SHOP}/inventory/purchases`);
      await page.getByRole('link', { name: 'Nueva compra' }).first().click();
      await page
        .getByLabel('Proveedor', { exact: true })
        .selectOption({ label: 'Proveedor nuevo…' });
      await page.getByLabel('Nombre del proveedor nuevo').fill(supplier);
      await page
        .getByLabel('Producto', { exact: true })
        .selectOption({ label: `${name} (tallos)` });
      await page.getByLabel('Cantidad', { exact: true }).fill('4x25');
      await page.getByLabel('Total pagado', { exact: true }).fill('1300');
      await expect(page.getByText('$13.00 por tallo')).toBeVisible();
      await expect(page.getByText('Total de la compra: $1,300.00')).toBeVisible();
      await page.getByRole('button', { name: 'Registrar compra' }).click();

      await expect(
        page.getByText('Compra registrada: la mercancía ya está en las existencias.'),
      ).toBeVisible();
      await expect(page.getByText(supplier)).toBeVisible();
      await expect(page.getByRole('cell', { name: '100 tallos' })).toBeVisible();

      // 50 al costo del catalogo (14,00) + 100 a 13,00 → costo reale 13,33.
      await openItem(page);
      await expect(page.getByText('150 tallos').first()).toBeVisible();
      await expect(page.getByText('$13.33')).toBeVisible();
      await page.getByRole('button', { name: 'Usar este costo en el catálogo' }).click();
      await expect(page.getByText('Listo: el catálogo ya usa el costo real.')).toBeVisible();

      // Anular la compra: la merce esce, niente si cancella.
      await page.goto(`${SHOP}/inventory/purchases?q=${encodeURIComponent(supplier)}`);
      await page.getByRole('link', { name: new RegExp(supplier) }).click();
      await page.getByRole('button', { name: 'Anular compra' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Anular compra' }).click();
      await expect(page.getByText(/Esta compra se anuló/)).toBeVisible();
      await openItem(page);
      await expect(page.getByText('50 tallos').first()).toBeVisible();
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
      // Gli apartados si vedono, ma non si creano.
      await expect(page.getByRole('link', { name: 'Apartar', exact: true })).toHaveCount(0);
      await page.goto(`${SHOP}/inventory/reservations`);
      await expect(
        page.getByText('Ves los apartados; los crean y los usan el propietario y el gerente.'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Nuevo apartado' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Compras' })).toHaveCount(0);
      await page.goto(`${SHOP}/inventory/reservations/new`);
      await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
      // Il riepilogo del mese ha i costi: lo staff non lo vede.
      await page.goto(`${SHOP}/inventory/movements`);
      await expect(page.getByRole('heading', { name: /^Resumen de / })).toHaveCount(0);
      await page.goto(`${SHOP}/inventory/start`);
      await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
    });
  });

  test.describe('apartados (proprietario)', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('apartar toglie dal disponibile; usar scarica quanto usato; liberar', async ({ page }) => {
      const label = `Boda E2E ${Date.now()}`;
      await openItem(page);
      await page.getByRole('link', { name: 'Apartar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Nuevo apartado' })).toBeVisible();

      // Il prodotto arriva già scelto dalla sua scheda; mentre si scrive si vede quanto manca.
      await page.getByRole('textbox', { name: 'Para', exact: true }).fill(label);
      await page.getByLabel('Cantidad', { exact: true }).fill('60');
      await expect(page.getByText('Disponibles: 50 tallos · Faltan 10 tallos')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apartar de todos modos' })).toBeVisible();
      await page.getByLabel('Cantidad', { exact: true }).fill('2x15');
      await page.getByRole('button', { name: 'Apartar', exact: true }).click();
      await expect(
        page.getByText('Apartado listo: esta mercancía ya no aparece como disponible.'),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
      await expect(page.getByText('Vence en 3 días')).toBeVisible();

      // Nella scheda del prodotto: 50 in giacenza, 30 apartados, 20 disponibili.
      await openItem(page);
      await expect(page.getByText('Apartados: 30 tallos · disponibles: 20 tallos')).toBeVisible();
      await page.getByRole('link', { name: new RegExp(`30 tallos para ${label}`) }).click();

      // Extender: nuova data.
      await page.getByRole('button', { name: 'Extender', exact: true }).click();
      const extendDialog = page.getByRole('dialog');
      await extendDialog.getByLabel('Vence el').fill(shopDate(5));
      await extendDialog.getByRole('button', { name: 'Guardar fecha' }).click();
      await expect(page.getByText('Fecha guardada.')).toBeVisible();
      await expect(page.getByText('Vence en 5 días')).toBeVisible();

      // Usar: se ne sono usati 28 su 30; i 2 restano in giacenza.
      await page.getByRole('button', { name: 'Usar', exact: true }).click();
      const useDialog = page.getByRole('dialog');
      const usedField = useDialog.getByLabel(`${name} (tallos)`);
      await expect(usedField).toHaveValue('30');
      await usedField.fill('28');
      await useDialog.getByRole('button', { name: 'Registrar uso' }).click();
      await expect(page.getByText('Uso registrado: el apartado se cerró.')).toBeVisible();
      await expect(
        page.getByText('Este apartado ya se usó: la mercancía salió del inventario.'),
      ).toBeVisible();
      await expect(page.getByText('Usado: 28 tallos')).toBeVisible();

      await openItem(page);
      await expect(page.getByText('22 tallos').first()).toBeVisible();
      await expect(page.getByText('Nada apartado de este producto.')).toBeVisible();
      await expect(page.getByText(label, { exact: true })).toBeVisible();

      // Un secondo apartado si libera: la giacenza non cambia.
      await page.getByRole('link', { name: 'Apartar', exact: true }).click();
      await page.getByRole('textbox', { name: 'Para', exact: true }).fill(`${label} B`);
      await page.getByLabel('Cantidad', { exact: true }).fill('5');
      await page.getByRole('button', { name: 'Apartar', exact: true }).click();
      await expect(page.getByRole('heading', { name: `${label} B`, level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Liberar', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Liberar', exact: true }).click();
      await expect(
        page.getByText('Apartado liberado: la mercancía vuelve a estar disponible.'),
      ).toBeVisible();

      // Nell'elenco, fra i cerrados, con lo stato di ognuno.
      await page.goto(`${SHOP}/inventory/reservations?view=closed&q=${encodeURIComponent(label)}`);
      await expect(page.getByText('2 apartados')).toBeVisible();
      await expect(page.getByText('Liberado', { exact: true })).toBeVisible();
      await expect(page.getByText('Usado', { exact: true })).toBeVisible();
      await openItem(page);
      await expect(page.getByText('22 tallos').first()).toBeVisible();
    });
  });

  test.describe('ramos, pannello e riepilogo (proprietario)', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('quanti ramos si possono fare e "Registrar ramos hechos"', async ({ page }) => {
      const bouquet = `Ramo inventario ${Date.now()}`;
      await page.goto(`${SHOP}/catalog/new`);
      await createProduct(page, { type: 'BOUQUET', name: bouquet, price: '500' });
      await page.getByRole('link', { name: 'Saltar por ahora' }).click();
      await page.getByRole('link', { name: 'Armar la receta' }).click();
      await page.getByLabel('Ingrediente', { exact: true }).selectOption({ label: name });
      await page.getByLabel('Cantidad', { exact: true }).fill('10');
      await page.getByRole('button', { name: 'Agregar ingrediente' }).click();
      await expect(page.getByText('Ingrediente agregado')).toBeVisible();

      // Nella scheda del ramo: 22 tallos disponibili, 10 per ramo → 2 ramos.
      await page.goto(`${SHOP}/catalog?q=${encodeURIComponent(bouquet)}`);
      await page.getByRole('link', { name: bouquet }).first().click();
      await expect(page.getByText('Con lo que tienes alcanzan para 2 ramos.')).toBeVisible();
      await expect(page.getByText('10 tallos por ramo · disponibles: 22 tallos')).toBeVisible();
      await expect(page.getByText(/^Previsto \(catálogo\):/)).toBeVisible();
      await expect(page.getByText(/^Real \(lo que pagaste\):/)).toBeVisible();

      // 3 ramos non ci stanno: avviso; con 2 sì.
      await page.getByRole('button', { name: 'Registrar ramos hechos' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Cuántos ramos').fill('3');
      await expect(dialog.getByText(`Faltan 8 tallos de ${name}`)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Registrar de todos modos' })).toBeVisible();
      await dialog.getByLabel('Cuántos ramos').fill('2');
      await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
      await expect(page.getByText('Listo: registramos 2 ramos hechos.')).toBeVisible();
      await expect(page.getByText('Con lo que tienes no alcanza para ningún ramo.')).toBeVisible();

      await openItem(page);
      await expect(page.getByText('2 tallos').first()).toBeVisible();
      await expect(page.getByText(`2 × ${bouquet}`, { exact: true })).toBeVisible();

      // Il pannello avvisa di ciò che sta finendo e porta all'elenco filtrato.
      await page.goto(SHOP);
      await page
        .getByRole('link', { name: /por agotarse/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/inventory\?status=LOW$/);

      // Riepilogo del mese nei movimenti, con il mese precedente.
      await page.goto(`${SHOP}/inventory/movements`);
      await expect(page.getByRole('heading', { name: /^Resumen de / })).toBeVisible();
      await page.getByRole('link', { name: 'Mes anterior' }).click();
      await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
      await expect(page.getByRole('link', { name: 'Mes siguiente' })).toBeVisible();
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
