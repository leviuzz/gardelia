import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectFitsAt320 } from './support/floral-care';
import { linkFrom, uniqueEmail, waitForEmail } from './support/mailbox';
import { ownClientHeaders } from './support/network';
import { closeStore, ensurePublishedWithOrders, setItemOnline } from './support/store';

/**
 * La vetrina che vende (marketplace, blocco M1-1, ADR-087). La fioreria mette in evidenza il ramo,
 * ne ordina le foto e scrive le politiche; chi compra vede testata, «Destacados», schede e
 * ricerca, apre la galleria, legge la cura della pianta, aggiunge al carrello (cookie), si
 * registra e ritrova il carrello nel modulo con il riepilogo completo. Un prodotto tolto mentre è
 * nel carrello sparisce con un avviso. Alla fine tutto torna com'era per gli altri test.
 */

const RAMO = fileURLToPath(new URL('./fixtures/ramo.jpg', import.meta.url));
const ROSA = fileURLToPath(new URL('./fixtures/rosa.jpg', import.meta.url));
const BOUQUET = 'Ramo Clásico 12 rosas';
const PLANT = 'Orquídea Phalaenopsis en maceta';
const RIBBON = 'Listón de satín';

async function openCatalogItem(page: Page, name: string) {
  await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent(name)}`);
  await page
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/catalog\/[0-9a-f-]{36}$/);
}

async function removePhotos(page: Page) {
  const buttons = page.getByTestId('item-photos').getByRole('button', { name: 'Quitar foto' });
  for (let count = await buttons.count(); count > 0; count = await buttons.count()) {
    await buttons.first().click();
    await expect(buttons).toHaveCount(count - 1);
  }
}

async function setStar(page: Page, name: string, on: boolean) {
  await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent(name)}`);
  const star = page.getByRole('button', { name: `Destacar ${name} en tu tienda en línea` }).last();
  if ((await star.getAttribute('aria-pressed')) !== String(on)) {
    await star.click();
    await expect(
      page.getByText(
        on ? 'Ahora sale en «Destacados» de tu tienda.' : 'Ya no sale en «Destacados».',
      ),
    ).toBeVisible();
  }
}

async function savePolicies(page: Page, cancellations: string, substitutions: string) {
  await page.goto('/app/las-camelias/settings/store');
  await page.getByLabel('Cancelaciones').fill(cancellations);
  await page.getByLabel('Sustitución de flores').fill(substitutions);
  await page.getByRole('button', { name: 'Guardar políticas' }).click();
  await expect(page.getByText('Políticas guardadas.')).toBeVisible();
}

test.describe('vitrina que vende (cliente y florería)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('destacados, búsqueda, galería, cuidados, carrito y resumen completo', async ({
    page,
    browser,
  }) => {
    // --- La florería prepara la tienda ---
    await ensurePublishedWithOrders(page);
    await setItemOnline(page, PLANT, true);
    await setItemOnline(page, RIBBON, true);
    // Due foto del ramo; la seconda diventa copertina.
    await openCatalogItem(page, BOUQUET);
    await removePhotos(page);
    await page.getByRole('button', { name: 'Fotos', exact: true }).setInputFiles([RAMO, ROSA]);
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(page.getByText('Se subieron 2 fotos')).toBeVisible();
    await expect(page.getByTestId('item-photos').getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Usar la foto 2 como portada' }).click();
    await expect(page.getByText('Portada cambiada', { exact: false })).toBeVisible();
    await setStar(page, BOUQUET, true);
    await savePolicies(
      page,
      'Puedes cancelar hasta 24 horas antes.',
      'Si falta una flor, usamos otra del mismo color.',
    );
    await page.goto('/app/las-camelias/settings/store');
    await expect(page.getByTestId('store-featured')).toContainText(BOUQUET);

    // --- Chi compra, senza conto ---
    const visitor = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: ownClientHeaders(),
    });
    const shopper = await visitor.newPage();
    await shopper.goto('/f/las-camelias');
    const facts = shopper.getByTestId('store-facts');
    await expect(facts.getByText('Pedidos en línea')).toBeVisible();
    await expect(facts.getByText(/^Entrega desde /)).toBeVisible();
    await expect(facts.getByText('Recoger en tienda')).toBeVisible();
    await expect(shopper.getByTestId('featured-items').getByText(BOUQUET)).toBeVisible();
    await expect(shopper.getByTestId('store-policies')).toContainText(
      'Puedes cancelar hasta 24 horas antes.',
    );
    await expectFitsAt320(shopper, 'storefront');

    // Schede e ricerca senza accenti.
    await shopper.getByRole('link', { name: /^Plantas/ }).click();
    await expect(shopper).toHaveURL(/categoria=plantas/);
    await expect(shopper.getByTestId('storefront').getByText(PLANT)).toBeVisible();
    await expect(shopper.getByTestId('storefront').getByText(BOUQUET)).toHaveCount(0);
    await shopper.goto('/f/las-camelias');
    await shopper.getByRole('searchbox', { name: 'Buscar en la tienda' }).fill('orquidea');
    await shopper.getByRole('button', { name: 'Buscar' }).click();
    await expect(shopper.getByTestId('results-count')).toContainText('1 resultado para «orquidea»');

    // La pianta: cura e cani e gatti dai nostri dati, con l'avviso.
    await shopper.getByRole('link', { name: new RegExp(PLANT) }).click();
    const care = shopper.getByTestId('item-plant-care');
    await expect(care.getByText('Cuidados según Gardelia')).toBeVisible();
    await expect(
      care.getByText('Aún no lo revisa un especialista.', { exact: false }),
    ).toBeVisible();
    await expect(shopper.getByTestId('item-first-day')).toBeVisible();

    // Il ramo: la copertina nuova, la galleria a schermo intero con avanti e indietro.
    await shopper.goto('/f/las-camelias');
    await shopper
      .getByTestId('featured-items')
      .getByRole('link', { name: new RegExp(BOUQUET) })
      .click();
    await shopper.getByTestId('gallery-main').click();
    const gallery = shopper.getByTestId('gallery-dialog');
    await expect(gallery.getByText('1 de 2')).toBeVisible();
    await gallery.getByRole('button', { name: 'Foto siguiente' }).click();
    await expect(gallery.getByText('2 de 2')).toBeVisible();
    await shopper.keyboard.press('ArrowRight');
    await expect(gallery.getByText('1 de 2')).toBeVisible();
    await gallery.getByRole('button', { name: 'Cerrar' }).click();
    await expect(gallery).toHaveCount(0);
    await expectFitsAt320(shopper, 'product');

    // Carrello: il listón dalla vetrina, poi due ramos con «Pedir ahora».
    await shopper.goto('/f/las-camelias?categoria=accesorios');
    await shopper.getByRole('button', { name: `Agregar ${RIBBON} a tu pedido` }).click();
    await expect(shopper.getByTestId('cart-bar')).toContainText('1 pieza');
    await shopper.goto('/f/las-camelias');
    await shopper
      .getByTestId('featured-items')
      .getByRole('link', { name: new RegExp(BOUQUET) })
      .click();
    await shopper.getByRole('button', { name: `Uno más de ${BOUQUET}` }).click();
    await shopper.getByRole('button', { name: 'Pedir ahora' }).click();
    await expect(shopper).toHaveURL(/\/login\?next=%2Ff%2Flas-camelias%2Fpedido/);
    await shopper.getByRole('link', { name: 'Regístrate' }).click();
    const email = uniqueEmail('vitrina');
    const password = 'una-clave-segura-789';
    await shopper.getByLabel('Nombre completo').fill('Renata Vitrina');
    await shopper.getByLabel('Correo electrónico').fill(email);
    await shopper.getByLabel('Contraseña', { exact: true }).fill(password);
    await shopper.getByLabel('Confirma la contraseña').fill(password);
    await shopper.getByRole('button', { name: 'Crear cuenta' }).click();
    const verification = await waitForEmail(email, { subject: 'Confirma tu correo' });
    await shopper.goto(linkFrom(verification, '/api/auth/verify-email'));
    await expect(shopper).toHaveURL(/\/f\/las-camelias\/pedido$/);

    // Nel modulo il carrello in cima, nell'ordine in cui è stato riempito.
    const cart = shopper.getByTestId('checkout-cart-items');
    await expect(cart.getByRole('spinbutton', { name: RIBBON })).toHaveValue('1');
    await expect(cart.getByRole('spinbutton', { name: BOUQUET })).toHaveValue('2');
    await expectFitsAt320(shopper, 'checkout-cart');

    // La fioreria toglie il listón: tornando al modulo sparisce, con l'avviso.
    await setItemOnline(page, RIBBON, false);
    await shopper.reload();
    await expect(shopper.getByTestId('cart-dropped')).toContainText('Quitamos 1 producto');
    await expect(cart.getByRole('spinbutton', { name: RIBBON })).toHaveCount(0);

    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await shopper.getByRole('radio', { name: 'Recoger en la tienda' }).check();
    const pickupInput = shopper.getByLabel('Día para recoger');
    await pickupInput.fill((await pickupInput.getAttribute('min')) ?? '');
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    await shopper.getByLabel('Mensaje de la tarjeta').fill('¡Felicidades, Paty!');
    await shopper.getByLabel('Firma').fill('Renata');
    await shopper.getByRole('button', { name: 'Continuar' }).click();
    // Riepilogo completo: tarjeta, firma e politiche della fioreria.
    await expect(shopper.getByText('¡Felicidades, Paty!')).toBeVisible();
    await expect(shopper.getByText('— Renata')).toBeVisible();
    await expect(shopper.getByTestId('checkout-policies')).toContainText(
      'Si falta una flor, usamos otra del mismo color.',
    );
    await shopper.getByLabel('Tu teléfono').fill('449 555 0188');
    await shopper.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(shopper).toHaveURL(/\/pedido\/[\w-]+\?enviado=1$/);

    // Dopo l'invio il carrello è vuoto.
    await shopper.goto('/f/las-camelias');
    await expect(shopper.getByTestId('cart-bar')).toHaveCount(0);
    await visitor.close();

    // --- Tutto com'era per gli altri test ---
    await setStar(page, BOUQUET, false);
    await openCatalogItem(page, BOUQUET);
    await removePhotos(page);
    await savePolicies(page, '', '');
    await setItemOnline(page, PLANT, false);
    await closeStore(page);
  });
});
