import { expect, test, type Page } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { runSystemSql } from './support/sql';
import { closeStore, ensurePublishedWithOrders } from './support/store';

/**
 * Strumenti della vetrina per la fioreria (marketplace, blocco M1-2, ADR-087): «Completa la tua
 * vetrina», link e QR anche prima di pubblicare, anteprima (sì il proprietario, no lo staff), più
 * prodotti accesi e spenti insieme dal Catalogo con la pagina 2 della vetrina, filtro «senza foto».
 * Alla fine tutto torna com'era per gli altri test.
 */

const SHOP = '/app/las-camelias';
const PREFIX = 'Vitrina prueba';
const COUNT = 25;

/**
 * 25 ramos spenti per la prova, una volta sola nel database dell'E2E: crearli uno per uno
 * dall'interfaccia è già provato altrove e qui conta solo averne più di una pagina della vetrina.
 * Il nome viene dopo «Ramo Clásico 12 rosas», che così resta in prima pagina per gli altri test.
 */
function ensureTestProducts() {
  runSystemSql(`
    INSERT INTO "CatalogItem"
      ("id", "tenantId", "type", "name", "saleUnit", "priceMinor", "currency", "isOnline", "updatedAt")
    SELECT gen_random_uuid(), t."id", 'BOUQUET', '${PREFIX} ' || lpad(n::text, 2, '0'), 'PIECE',
      30000 + n, 'MXN', false, now()
    FROM "Tenant" t, generate_series(1, ${COUNT}) AS n
    WHERE t."slug" = 'las-camelias'
      AND NOT EXISTS (
        SELECT 1 FROM "CatalogItem" c
        WHERE c."tenantId" = t."id" AND c."name" = '${PREFIX} ' || lpad(n::text, 2, '0')
      );
    -- Spenti, anche se un giro interrotto li ha lasciati accesi.
    UPDATE "CatalogItem" SET "isOnline" = false, "featuredAt" = NULL
    WHERE "name" LIKE '${PREFIX} %'
      AND "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'las-camelias');`);
}

/** «Mostrar» o «Quitar» per tutti i prodotti di prova, una pagina del Catalogo alla volta. */
async function bulkSet(page: Page, online: boolean) {
  const filter = online ? 'no' : 'yes';
  for (const expected of [20, 5]) {
    await page.goto(`${SHOP}/catalog?q=${encodeURIComponent(PREFIX)}&online=${filter}`);
    await page.getByRole('checkbox', { name: 'Seleccionar los productos de esta página' }).check();
    const bar = page.getByTestId('catalog-bulk-bar');
    await expect(bar).toContainText(`${expected} seleccionados`);
    await bar
      .getByRole('button', { name: online ? 'Mostrar en la tienda' : 'Quitar de la tienda' })
      .click();
    await expect(
      page.getByText(
        online
          ? `${expected} productos ahora se ven en tu tienda.`
          : `${expected} productos ya no aparecen en tu tienda.`,
      ),
    ).toBeVisible();
  }
  await page.goto(`${SHOP}/catalog?q=${encodeURIComponent(PREFIX)}&online=${filter}`);
  await expect(page.getByText('No hay productos con estos filtros')).toBeVisible();
}

function readinessStep(page: Page, step: string) {
  return page.getByTestId('store-readiness').locator(`[data-step="${step}"]`);
}

test.describe('strumenti della vetrina (M1-2)', () => {
  test.describe('propietaria', () => {
    test.use({ storageState: 'e2e/.auth/owner.json' });

    test('link e QR prima di pubblicare, anteprima, più prodotti insieme e pagina 2', async ({
      page,
    }) => {
      ensureTestProducts();
      await closeStore(page);

      // --- Prima di pubblicare: link, QR da scaricare, lista da completare ---
      await page.goto(`${SHOP}/settings/store`);
      const link = page.getByTestId('store-link');
      await expect(link.getByRole('textbox', { name: 'Enlace de tu tienda' })).toHaveValue(
        /\/f\/las-camelias$/,
      );
      await expect(
        link.getByText('Funcionará cuando publiques tu tienda.', { exact: false }),
      ).toBeVisible();
      await expect(link.getByRole('img', { name: /Código QR que abre/ })).toBeVisible();
      const download = page.waitForEvent('download');
      await link.getByRole('button', { name: 'Descargar el QR' }).click();
      expect((await download).suggestedFilename()).toBe('las-camelias-qr.png');
      await expect(readinessStep(page, 'products')).toHaveAttribute('data-done', 'false');
      await expectFitsAt320(page, 'store-settings-link');

      // Anteprima di un negozio non pubblicato: la vede solo la fioreria.
      await link.getByRole('link', { name: 'Vista previa' }).click();
      await expect(page).toHaveURL(/\/settings\/store\/preview$/);
      const banner = page.getByTestId('store-preview-banner');
      await expect(
        banner.getByText('Así verán tu tienda tus clientes.', { exact: false }),
      ).toBeVisible();
      await expect(
        banner.getByText('Tu tienda todavía no está publicada', { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByTestId('store-preview').getByRole('heading', { level: 1 }),
      ).toBeVisible();
      const visitor = await page
        .context()
        .browser()!
        .newContext({
          storageState: { cookies: [], origins: [] },
        });
      const outsider = await visitor.newPage();
      const response = await outsider.goto('/f/las-camelias');
      expect(response?.status()).toBe(404);
      await visitor.close();

      // --- 25 prodotti accesi insieme dal Catalogo ---
      await ensurePublishedWithOrders(page);
      await bulkSet(page, true);

      // La vetrina ha la pagina 2.
      await page.goto('/f/las-camelias');
      await expect(page.getByText('Página 1 de', { exact: false })).toBeVisible();
      await page.getByRole('link', { name: 'Siguiente' }).click();
      await expect(page).toHaveURL(/pagina=2/);
      await expect(page.getByTestId('storefront').getByText(`${PREFIX} 25`)).toBeVisible();

      // L'anteprima del negozio pubblicato: pulsanti d'ordine spenti, prodotto apribile.
      await page.goto(`${SHOP}/settings/store/preview`);
      await expect(
        page
          .getByTestId('store-preview-banner')
          .getByText('Tu tienda todavía no está publicada', { exact: false }),
      ).toHaveCount(0);
      const preview = page.getByTestId('store-preview');
      await expect(preview.getByRole('button', { name: 'Hacer un pedido' })).toBeDisabled();
      await preview
        .getByRole('link', { name: /Ramo Clásico 12 rosas/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/settings\/store\/preview\/p\/[0-9a-f-]{36}$/);
      await expect(
        page.getByTestId('store-preview').getByRole('button', { name: 'Pedir ahora' }),
      ).toBeDisabled();
      await expectFitsAt320(page, 'store-preview-item');

      // Lista: ora i prodotti bastano; il filtro «senza foto» li trova.
      await page.goto(`${SHOP}/settings/store`);
      await expect(readinessStep(page, 'products')).toHaveAttribute('data-done', 'true');
      await page.goto(`${SHOP}/catalog`);
      await expect(page.getByTestId('catalog-no-photo')).toBeVisible();
      await page.goto(`${SHOP}/catalog?online=no_photo&q=${encodeURIComponent(PREFIX)}`);
      await expect(page.getByText('25 productos').first()).toBeVisible();
      await expect(
        page.locator('table').getByText('Sin foto', { exact: true }).first(),
      ).toBeVisible();

      // --- Spenti insieme: tutto com'era ---
      await bulkSet(page, false);
      await closeStore(page);
    });
  });

  test.describe('staff', () => {
    test.use({ storageState: 'e2e/.auth/staff.json' });

    test("lo staff non vede l'anteprima", async ({ page }) => {
      await page.goto(`${SHOP}/settings/store/preview`);
      await expect(page.getByText('Sin acceso a esta sección')).toBeVisible();
      await expect(page.getByTestId('store-preview')).toHaveCount(0);
    });
  });
});
