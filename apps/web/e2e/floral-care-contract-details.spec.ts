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
 * Floral Care, feedback del founder del 25/11 (rilascio 1):
 * - «Usar los datos del cliente» nella sede del contratto: persona e telefono dal destinatario
 *   dell'indirizzo o dal cliente, aggiornati cambiando indirizzo, scrivibili a interruttore spento;
 * - i servizi nella lingua di chi usa l'app (qui l'italiano), con le traduzioni scritte dal
 *   fiorista per i suoi servizi.
 */
test.describe('Floral Care: dettagli del contratto e lingue dei servizi', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('«Usar los datos del cliente» riempie persona e telefono della sede', async ({ page }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    await saveOffer(page, '24');
    const slot = await addSlot(page, tomorrow, 0);

    // Cliente con telefono; due indirizzi, il secondo con chi riceve.
    const name = `Despacho Contacto ${stamp}`;
    await page.goto(`${SHOP}/customers/new`);
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Teléfono', exact: true }).fill('449 555 0101');
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    // Il modulo dell'indirizzo si apre nella pagina (non in una finestra).
    const addAddress = async (street: string, recipient?: { name: string; phone: string }) => {
      await page.getByRole('button', { name: 'Agregar dirección' }).click();
      await page.getByRole('textbox', { name: 'Calle y número' }).fill(street);
      await page.getByRole('textbox', { name: 'Código postal' }).fill('20000');
      await page.getByRole('textbox', { name: 'Municipio o alcaldía' }).fill('Aguascalientes');
      if (recipient) {
        await page.getByRole('textbox', { name: 'Recibe', exact: true }).fill(recipient.name);
        await page.getByRole('textbox', { name: 'Teléfono de quien recibe' }).fill(recipient.phone);
      }
      await page.getByRole('button', { name: 'Agregar dirección' }).click();
      await expect(page.getByText('Dirección agregada').last()).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Calle y número' })).toHaveCount(0);
    };
    await addAddress('Av. Universidad 100');
    await addAddress('Calle Madero 22', { name: 'Recepción', phone: '449 555 0202' });

    await page.getByRole('link', { name: 'Nuevo contrato' }).click();
    const toggle = page.getByRole('checkbox', { name: /Usar los datos del cliente/ });
    const contact = page.getByRole('textbox', { name: 'Persona de contacto' });
    const phone = page.getByRole('textbox', { name: 'Teléfono del lugar' });
    // Acceso di partenza: i dati del cliente, non scrivibili.
    await expect(toggle).toBeChecked();
    await expect(contact).toHaveValue(name);
    await expect(phone).toHaveValue('449 555 0101');
    await expect(contact).not.toBeEditable();

    await expectFitsAt320(page, 'contract-contact');

    // Un'altra sede: chi riceve lì.
    await page.getByRole('radio', { name: /Calle Madero 22/ }).check();
    await expect(contact).toHaveValue('Recepción');
    await expect(phone).toHaveValue('449 555 0202');

    // Spento si scrive, partendo da quello che c'era.
    await toggle.uncheck();
    await expect(contact).toBeEditable();
    await expect(contact).toHaveValue('Recepción');
    await contact.fill('Don Luis');
    await toggle.check();
    await expect(contact).toHaveValue('Recepción');
    await toggle.uncheck();
    await contact.fill('Don Luis');

    await page.getByRole('radio', { name: /Cada semana/ }).check();
    await page.getByRole('checkbox', { name: slot.label }).check();
    await page.getByRole('textbox', { name: 'Primer día' }).fill(tomorrow);
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByText('Don Luis', { exact: false })).toBeVisible();

    // Nella bozza i dati sono diversi da quelli del cliente: l'interruttore parte spento.
    await page.getByRole('link', { name: 'Editar borrador' }).click();
    await expect(
      page.getByRole('checkbox', { name: /Usar los datos del cliente/ }),
    ).not.toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Persona de contacto' })).toHaveValue(
      'Don Luis',
    );

    await archiveSlot(page, slot.label);
  });

  test('con l’app in italiano i servizi si leggono in italiano', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'it-IT', url: baseURL ?? '' }]);
    await page.goto(`${SHOP}/settings/floral-care`);
    await expect(page.getByText('Irrigazione', { exact: true })).toBeVisible();
    await expect(page.getByText('Riego', { exact: true })).toHaveCount(0);

    // Un servizio nuovo: il nome per i clienti in spagnolo, la traduzione in italiano.
    const stamp = Date.now();
    const spanish = `Limpieza de vidrios ${stamp}`;
    const italian = `Pulizia dei vetri ${stamp}`;
    await page.getByRole('button', { name: 'Aggiungi servizio' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Traduzioni (facoltative)')).toBeVisible();
    await expectFitsAt320(page, 'service-translations');
    await dialog.getByRole('textbox', { name: 'Nome in spagnolo' }).fill(spanish);
    await dialog.getByRole('textbox', { name: 'In italiano' }).fill(italian);
    await dialog.getByRole('radio', { name: /Extra/ }).check();
    await dialog.getByRole('textbox', { name: 'Prezzo (MXN)' }).fill('50');
    await dialog.getByRole('button', { name: 'Aggiungi servizio' }).click();
    await expect(page.getByText('Servizio aggiunto')).toBeVisible();
    await expect(page.getByText(italian, { exact: true })).toBeVisible();
    await expect(page.getByText(spanish, { exact: true })).toHaveCount(0);

    // In spagnolo si vede il nome principale. Poi si archivia: non tocca gli altri test.
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'es-MX', url: baseURL ?? '' }]);
    await page.reload();
    await expect(page.getByText(spanish, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Archivar ${spanish}` }).click();
    await expect(page.getByRole('button', { name: `Archivar ${spanish}` })).toHaveCount(0);
  });
});
