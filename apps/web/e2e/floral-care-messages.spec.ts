import { expect, test } from '@playwright/test';
import {
  SHOP,
  acceptInviteAsNewPerson,
  addSlot,
  archiveSlot,
  createConfirmedContract,
  dayInShop,
  endContract,
  expectFitsAt320,
  inviteFromContract,
  saveOffer,
} from './support/floral-care';
import { uniqueEmail } from './support/mailbox';

/**
 * Floral Care, blocco 5b (ADR-084): i messaggi fra cliente e fioreria. La persona invitata scrive
 * dal suo contratto con una foto; la proprietaria trova il non letto nel pannello e in «Mensajes»,
 * apre il filo (che diventa letto per tutta la squadra) e risponde; lo staff vede il filo ma non
 * toglie foto; la persona trova la risposta come nuova. Poi la proprietaria toglie la foto. Alla
 * fine il contratto finisce e l'orario si archivia.
 */
test.describe('Floral Care: i messaggi fra cliente e fioreria', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  // Registrazione della persona, tre conti e due giri di lettura: più del minuto standard.
  test.setTimeout(120_000);

  test('il cliente scrive con una foto, la fioreria vede il non letto e risponde', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    await saveOffer(page, '24');
    const slot = await addSlot(page, tomorrow, 0);
    const customer = `Oficinas Mensajes ${stamp}`;
    const { contractUrl } = await createConfirmedContract(page, {
      customer,
      slotLabel: slot.label,
      firstDay: tomorrow,
    });

    // Prima dell'invito il filo è vuoto e la card dice che nessuno del cliente lo legge.
    const shopCard = page.getByTestId('care-messages-card');
    await expect(shopCard.getByText('Todavía no hay mensajes.')).toBeVisible();
    await expect(shopCard.getByText(/Nadie del cliente ve este servicio/)).toBeVisible();

    const email = uniqueEmail('mensajes');
    const invitePath = await inviteFromContract(page, email);
    const { visitor, person, portalUrl } = await acceptInviteAsNewPerson(browser, {
      invitePath,
      email,
      name: 'Marta Jardines',
    });

    // La persona scrive con una foto.
    const mine = person.getByTestId('my-care-messages');
    await expect(mine.getByText('Todavía no hay mensajes.')).toBeVisible();
    // Un invio vuoto non parte.
    await mine.getByRole('button', { name: 'Enviar' }).click();
    await expect(mine.getByText('Escribe un mensaje o agrega una foto.')).toBeVisible();
    const question = `Hola, ¿pueden revisar el potos de la entrada? Tiene hojas amarillas. ${stamp}`;
    await mine.getByLabel('Mensaje').fill(question);
    await mine.getByTestId('message-photo-input').setInputFiles('e2e/fixtures/ramo.jpg');
    await expect(mine.getByText('Foto: ramo.jpg')).toBeVisible();
    await mine.getByRole('button', { name: 'Enviar' }).click();
    await expect(person.getByText('Mensaje enviado')).toBeVisible();
    await expect(mine.getByTestId('message')).toHaveCount(1);
    await expect(mine.getByText(question)).toBeVisible();
    await expect(mine.getByRole('img', { name: 'Foto del mensaje' })).toBeVisible();
    await expect(mine.getByText('Tú', { exact: true })).toBeVisible();
    await expect(mine.getByLabel('Mensaje')).toHaveValue('');
    await expectFitsAt320(person, 'messages');

    // La fioreria: il riquadro del pannello, la scheda «Mensajes (N)» e il filo da leggere.
    await page.goto(SHOP);
    const unreadCard = page.getByTestId('care-unread-messages');
    await expect(unreadCard).toBeVisible();
    await unreadCard.getByRole('link', { name: 'Ver mensajes' }).click();
    await expect(page).toHaveURL(/\/subscriptions\/messages$/);
    await expect(
      page.getByTestId('care-tabs').getByRole('link', { name: /^Mensajes \(\d+\)$/ }),
    ).toBeVisible();
    const row = page.getByTestId('care-threads').getByRole('link').filter({ hasText: customer });
    await expect(row.getByText('1 sin leer')).toBeVisible();
    await expect(row.getByText(/^Cliente: Hola, ¿pueden revisar el potos/)).toBeVisible();
    await expectFitsAt320(page, 'shop-messages');
    await row.click();
    await expect(page).toHaveURL(/#mensajes$/);
    await expect(shopCard.getByRole('separator')).toHaveText('Sin leer');
    await expect(shopCard.getByText('Marta Jardines')).toBeVisible();
    await expect(shopCard.getByText(question)).toBeVisible();
    await expect(shopCard.getByRole('img', { name: 'Foto del mensaje' })).toBeVisible();
    await expect(shopCard.getByText(/Nadie del cliente ve este servicio/)).toHaveCount(0);

    // La foto si apre solo dalla sua route privata.
    const thumb = await shopCard.getByRole('img', { name: 'Foto del mensaje' }).getAttribute('src');
    expect(thumb).toMatch(/\/messages\/photos\/[0-9a-f-]{36}\?size=thumb$/);
    const image = await page.request.get(thumb ?? '');
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/jpeg');
    // Chi non è della fioreria (anche con una sessione) riceve 404.
    const stranger = await visitor.request.get(thumb ?? '', { maxRedirects: 0 });
    expect(stranger.status()).toBe(404);

    // La proprietaria risponde.
    const answer = `Claro, mañana lo revisamos en la visita. ${stamp}`;
    await shopCard.getByLabel('Mensaje').fill(answer);
    await shopCard.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Mensaje enviado')).toBeVisible();
    await expect(shopCard.getByTestId('message')).toHaveCount(2);
    await expect(shopCard.getByText(answer)).toBeVisible();
    await expectFitsAt320(page, 'shop-thread');

    // Il filo è letto per tutta la squadra: lo staff lo vede senza "sin leer" e senza «Quitar foto».
    const staffContext = await browser.newContext({ storageState: 'e2e/.auth/staff.json' });
    const staff = await staffContext.newPage();
    await staff.goto(`${SHOP}/subscriptions/messages`);
    const staffRow = staff
      .getByTestId('care-threads')
      .getByRole('link')
      .filter({ hasText: customer });
    await expect(staffRow.getByText(/^Florería: Claro, mañana lo revisamos/)).toBeVisible();
    await expect(staffRow.getByText(/sin leer/)).toHaveCount(0);
    await expect(staff.getByTestId('care-tabs').getByRole('link', { name: 'Cobros' })).toHaveCount(
      0,
    );
    await staffRow.click();
    const staffCard = staff.getByTestId('care-messages-card');
    await expect(staffCard.getByText(answer)).toBeVisible();
    await expect(staffCard.getByRole('button', { name: 'Quitar foto' })).toHaveCount(0);
    await expect(staffCard.getByTestId('message-composer')).toBeVisible();
    await staffContext.close();

    // La persona: il messaggio nuovo nell'elenco, nella card di «Mi cuenta» e nel filo.
    await person.goto('/cuenta');
    await expect(
      person.getByTestId('account-floral-care').getByText('1 mensaje nuevo'),
    ).toBeVisible();
    await person.goto('/cuenta/floral-care');
    await expect(person.getByText('1 mensaje nuevo')).toBeVisible();
    await person.goto(portalUrl);
    await expect(mine.getByRole('separator')).toHaveText('Nuevos');
    await expect(mine.getByText(answer)).toBeVisible();
    await expect(mine.getByText('Lucía Hernández')).toBeVisible();
    // Dopo averlo visto non è più nuovo.
    await expect(async () => {
      await person.reload();
      await expect(mine.getByRole('separator')).toHaveCount(0);
    }).toPass({ timeout: 10_000 });
    await person.goto('/cuenta/floral-care');
    await expect(person.getByText(/mensajes? nuevos?/)).toHaveCount(0);

    // «Quitar foto»: il file sparisce per tutti, il testo resta.
    await page.goto(contractUrl);
    await shopCard.getByRole('button', { name: 'Quitar foto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar foto' }).click();
    await expect(page.getByText('Foto quitada')).toBeVisible();
    await expect(shopCard.getByText('La foto ya no está disponible.')).toBeVisible();
    await expect(shopCard.getByText(question)).toBeVisible();
    expect((await page.request.get(thumb ?? '')).status()).toBe(404);
    await person.goto(portalUrl);
    await expect(mine.getByText('La foto ya no está disponible.')).toBeVisible();
    await visitor.close();

    // Fine: contratto finito, orario archiviato.
    await endContract(page, contractUrl, tomorrow);
    await archiveSlot(page, slot.label);
  });
});
