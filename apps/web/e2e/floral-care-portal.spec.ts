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
import { runSystemSql } from './support/sql';

/**
 * Floral Care, blocco 5a (ADR-084): la pagina del cliente. La proprietaria (fioreria demo: niente
 * email, il link sì) invita una persona dal contratto; la persona si registra dal link, accetta e
 * trova "Mi Floral Care"; cambia la data della visita a un altro orario libero dello stesso giorno;
 * la fioreria lo vede nell'Agenda; "Quitar acceso" chiude la pagina. Poi un altro conto e un invito
 * scaduto. Alla fine il contratto finisce, gli orari si archiviano e il preavviso torna a 24 ore.
 */
test.describe('Floral Care: la pagina del cliente', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('invito, registrazione, Mi Floral Care, "Cambiar fecha" e "Quitar acceso"', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    // Preavviso 0: la visita di domani si può cambiare a qualsiasi ora del giorno del test.
    await saveOffer(page, '0');
    const slot = await addSlot(page, tomorrow, 0);
    const other = await addSlot(page, tomorrow, slot.start);

    // Cliente, contratto settimanale da domani nell'orario nuovo, piante, conferma.
    const { contractUrl, number } = await createConfirmedContract(page, {
      customer: `Hotel Portal ${stamp}`,
      slotLabel: slot.label,
      firstDay: tomorrow,
    });

    // "Acceso del cliente": una fioreria demo non manda email, il link sì.
    const card = page.getByTestId('portal-access-card');
    const email = uniqueEmail('portal');
    const invitePath = await inviteFromContract(page, email);

    // Con il conto della fioreria (altra email) l'invito chiede di cambiare conto.
    await page.goto(invitePath);
    await expect(page.getByText(/pero la invitación es para/)).toBeVisible();

    // La persona: dal link alla registrazione, verifica dell'email, accetta.
    const { visitor, person, portalUrl } = await acceptInviteAsNewPerson(browser, {
      invitePath,
      email,
      name: 'Lucía Recepción',
    });
    await expect(person.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(person.getByText('Próximas visitas')).toBeVisible();
    await expect(person.getByText('Potos en jardinera')).toBeVisible();
    await expect(person.getByTestId('my-care-charges')).toBeVisible();
    await expectFitsAt320(person, 'contract');

    // "Cambiar fecha": l'altro orario dello stesso giorno.
    await person
      .getByTestId('my-care-upcoming')
      .getByRole('link', { name: 'Cambiar fecha' })
      .first()
      .click();
    await expect(person.getByRole('heading', { level: 1, name: 'Cambiar fecha' })).toBeVisible();
    await expectFitsAt320(person, 'change');
    await person
      .getByTestId('change-date-options')
      .getByRole('radio', { name: other.time })
      .first()
      .check();
    await person.getByRole('button', { name: 'Cambiar a este horario' }).click();
    await expect(person).toHaveURL(/\?cambiada=/);
    await expect(person.getByText(/Listo: tu visita quedó el/)).toBeVisible();
    await expect(person.getByText('Fecha elegida por ti').first()).toBeVisible();

    // La fioreria lo vede nell'Agenda di domani.
    await page.goto(`${SHOP}/agenda?date=${tomorrow}`);
    const visit = page.getByRole('article').filter({ hasText: number });
    await expect(visit.getByText('Cambiada por el cliente')).toBeVisible();

    // "Quitar acceso": la pagina del cliente non si apre più.
    await page.goto(contractUrl);
    const people = page.getByTestId('portal-people');
    await expect(people.getByText('Lucía Recepción')).toBeVisible();
    await expectFitsAt320(page, 'shop-card');
    await people.getByRole('button', { name: 'Quitar acceso' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar acceso' }).click();
    await expect(page.getByText('Acceso quitado.')).toBeVisible();
    const gone = await person.goto(portalUrl);
    expect(gone?.status()).toBe(404);
    await visitor.close();

    // Un invito scaduto lo dice.
    await card.getByLabel('Correo').fill(uniqueEmail('portal-tarde'));
    await card.getByRole('button', { name: 'Invitar' }).click();
    await expect(page.getByText('Invitación lista: copia el enlace y mándalo.')).toBeVisible();
    const lateUrl = await card.getByTestId('portal-invite-url').first().inputValue();
    runSystemSql(
      `UPDATE "CarePortalInvite" SET "createdAt" = now() - interval '9 days', "expiresAt" = now() - interval '1 day' WHERE "status" = 'PENDING' AND "email" LIKE 'portal-tarde-%';`,
    );
    await page.goto(new URL(lateUrl).pathname);
    await expect(
      page.getByText('La invitación venció. Pide a la florería que te mande otra.'),
    ).toBeVisible();

    // Fine: contratto finito, orari archiviati, preavviso come prima.
    await endContract(page, contractUrl, tomorrow);
    await archiveSlot(page, slot.label);
    await archiveSlot(page, other.label);
    await saveOffer(page, '24');
  });
});
