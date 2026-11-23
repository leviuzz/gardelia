import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Foto del catalogo e "Mis ramos" (ADR-029): caricamento reale dal browser (riduzione
 * lato client + ricodifica sul server), immagini private per fioreria, consenso obbligatorio.
 * Scontorno automatico (ADR-033): in E2E lavora l'algoritmo locale per fondi lisi, quindi la
 * foto di prova (fiore su fondo crema) esce davvero senza fondo.
 * Ogni test toglie le foto che carica, così le esecuzioni ripetute restano sotto i limiti.
 */
const ROSA = fileURLToPath(new URL('./fixtures/rosa.jpg', import.meta.url));
const RAMO = fileURLToPath(new URL('./fixtures/ramo.jpg', import.meta.url));

async function openItem(page: Page, query: string) {
  await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent(query)}`);
  await page
    .getByRole('link', { name: new RegExp(query) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/catalog\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible();
}

/** Toglie le foto rimaste da esecuzioni precedenti interrotte (dati demo). */
async function removeLeftoverPhotos(page: Page) {
  const buttons = page.getByTestId('item-photos').getByRole('button', { name: 'Quitar foto' });
  for (let count = await buttons.count(); count > 0; count = await buttons.count()) {
    await buttons.first().click();
    await expect(buttons).toHaveCount(count - 1);
  }
}

test.describe('foto del catalogo (proprietario)', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('carica una foto di una flor: fondo tolto, privata, si può togliere', async ({
    page,
    browser,
  }) => {
    await openItem(page, 'Rosa roja');
    await removeLeftoverPhotos(page);
    await expect(page.getByText('Usa un fondo liso que contraste con el producto')).toBeVisible();
    await expect(page.getByText('Quitamos el fondo de cada foto automáticamente.')).toBeVisible();
    await page.getByLabel('Vista').selectOption('SIDE');
    await page.getByRole('button', { name: 'Fotos', exact: true }).setInputFiles(ROSA);
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(page.getByText('Se subió 1 foto')).toBeVisible();

    // Il ritaglio arriva da solo: la pagina si aggiorna finché la foto è pronta.
    const tile = page.getByTestId('item-photos').getByRole('listitem').first();
    await expect(tile).toHaveAttribute('data-cutout', 'READY', { timeout: 20_000 });
    await expect(tile.getByText('Sin fondo')).toBeVisible();
    const photo = tile.getByRole('img', { name: 'Foto de «Rosa roja», De lado, sin fondo' });
    const cutoutSrc = await photo.getAttribute('src');
    expect(cutoutSrc).toMatch(/\/catalog\/photos\/[0-9a-f-]{36}\?size=cutout-thumb$/);
    const cutout = await page.request.get(cutoutSrc!);
    expect(cutout.status()).toBe(200);
    expect(cutout.headers()['content-type']).toBe('image/png');
    // L'originale resta (copertina del catalogo, Builder).
    const src = cutoutSrc!.replace('size=cutout-thumb', 'size=thumb');
    const original = await page.request.get(src);
    expect(original.status()).toBe(200);
    expect(original.headers()['content-type']).toBe('image/jpeg');

    // Un'altra fioreria non le vede (404, non 403).
    const other = await browser.newContext({ storageState: 'e2e/.auth/other-owner.json' });
    for (const url of [src, cutoutSrc!]) {
      const otherUrl = url.replace('/app/las-camelias/', '/app/flores-del-valle/');
      expect((await other.request.get(otherUrl)).status()).toBe(404);
    }
    await other.close();

    // Copertina nell'elenco del catalogo: la foto originale (cercando il prodotto, perché l'elenco
    // è paginato e gli altri test aggiungono prodotti).
    await page.goto(`/app/las-camelias/catalog?q=${encodeURIComponent('Rosa roja')}`);
    await expect(page.locator(`img[src="${src}"]:visible`)).toHaveCount(1);

    await page.goBack();
    await page
      .getByRole('listitem')
      .filter({ has: page.locator(`img[src="${cutoutSrc}"]`) })
      .getByRole('button', { name: 'Quitar foto' })
      .click();
    await expect(page.getByText('Foto quitada')).toBeVisible();
    await expect(page.locator(`img[src="${cutoutSrc}"]`)).toHaveCount(0);
    expect((await page.request.get(src)).status()).toBe(404);
    expect((await page.request.get(cutoutSrc!)).status()).toBe(404);
  });

  test('nastri: il colore della foto è obbligatorio e appare sulla foto', async ({ page }) => {
    await openItem(page, 'Listón de satín');
    await removeLeftoverPhotos(page);
    await expect(page.getByLabel('Color de la foto')).toHaveAttribute('required', '');
    await page.getByLabel('Color de la foto').selectOption('cream');
    await page.getByRole('button', { name: 'Fotos', exact: true }).setInputFiles(ROSA);
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(page.getByText('Se subió 1 foto')).toBeVisible();
    const card = page
      .getByTestId('item-photos')
      .getByRole('listitem')
      .filter({ has: page.getByRole('img', { name: /Foto de «Listón de satín» en Crema/ }) })
      .first();
    await expect(card.getByText('Crema')).toBeVisible();
    await card.getByRole('button', { name: 'Quitar foto' }).click();
    await expect(page.getByText('Foto quitada')).toBeVisible();
  });
});

test.describe('foto del catalogo (staff)', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('lo staff vede la sezione ma non carica né toglie foto', async ({ page }) => {
    await openItem(page, 'Rosa roja');
    await expect(page.getByRole('button', { name: 'Subir fotos' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Quitar foto' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Quitar el fondo|Reintentar/ })).toHaveCount(0);
  });
});

test.describe('Mis ramos', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('senza consenso non si carica; con consenso la foto appare e si può togliere', async ({
    page,
  }) => {
    await page.goto('/app/las-camelias/builder');
    await page.getByRole('link', { name: 'Mis ramos' }).click();
    await expect(page.getByRole('heading', { name: 'Mis ramos' })).toBeVisible();
    await expect(page.getByText(/Nunca se usan para entrenar modelos de IA/)).toBeVisible();
    // Qui il fondo resta: fa parte dello stile.
    await expect(page.getByText(/Aquí no quitamos el fondo/)).toBeVisible();

    await page.getByLabel('Estilo del ramo').selectOption('GARDEN');
    await page.getByLabel('Nota (opcional)').fill('Ramo de prueba E2E');
    await page.getByRole('button', { name: 'Fotos', exact: true }).setInputFiles(RAMO);
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(page.getByText('Para subir fotos confirma la autorización.')).toBeVisible();

    await page
      .getByRole('checkbox', { name: /autorizo usarlas como referencia de estilo/ })
      .check();
    await page.getByRole('button', { name: 'Subir fotos' }).click();
    await expect(page.getByText('Se subió 1 foto')).toBeVisible();
    const item = page
      .getByTestId('style-references')
      .getByRole('listitem')
      .filter({ hasText: 'Ramo de prueba E2E' })
      .first();
    await expect(
      item.getByRole('img', { name: 'Ramo de tu florería, estilo Jardín' }),
    ).toBeVisible();
    await item.getByRole('button', { name: 'Quitar foto' }).click();
    await expect(page.getByText('Foto quitada')).toBeVisible();
  });
});

test.describe('Mis ramos (fioreria Basic)', () => {
  test.use({ storageState: 'e2e/.auth/other-owner.json' });

  test('senza Plus si vede l’invito all’upgrade', async ({ page }) => {
    await page.goto('/app/flores-del-valle/builder/references');
    await expect(
      page.getByRole('heading', { name: 'El diseñador de ramos está incluido en Gardelia Plus' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subir fotos' })).toHaveCount(0);
  });
});
