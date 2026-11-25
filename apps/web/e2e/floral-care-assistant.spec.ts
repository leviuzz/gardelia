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
 * Floral Care, blocco 6b (ADR-085): l'Asistente de plantas per i clienti della fioreria, con
 * l'assistente simulato (etichettato). La proprietaria vede i crediti della fioreria in Ajustes e
 * ne dà 3 al contratto; la persona invitata consulta da Mi Floral Care: foto → «Tiene un problema»
 * proposto dalla foto → «Cómo cuidarla» e «Otra» dalla lista → risposta con cura e avviso per cani e
 * gatti dai nostri dati; restano 2 consultas; «Enviar a la florería» manda il caso nel filo, che la
 * fioreria vede con le consultas usate. Controllo a 320 px.
 */
test.describe('Floral Care: Asistente de plantas para los clientes', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  // Registrazione della persona, foto, risposta e due conti: più del minuto standard.
  test.setTimeout(150_000);

  test('la florería da créditos y el cliente consulta desde Mi Floral Care', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    await saveOffer(page, '24');

    // Ajustes → Floral Care: i crediti della fioreria (dal seed) e come comprarne altri.
    const settings = page.getByTestId('assistant-credits-settings');
    await expect(settings.getByText(/1 crédito = 1 respuesta para tu cliente/)).toBeVisible();
    await expect(
      settings.getByRole('link', { name: 'Comprar créditos por WhatsApp' }),
    ).toHaveAttribute('href', /wa\.me/);
    const available = Number(await settings.getByTestId('assistant-shop-remaining').textContent());
    expect(available).toBeGreaterThanOrEqual(3);
    await expectFitsAt320(page, 'assistant-settings');

    const slot = await addSlot(page, tomorrow, 0);
    const { contractUrl } = await createConfirmedContract(page, {
      customer: `Oficinas Asistente ${stamp}`,
      slotLabel: slot.label,
      firstDay: tomorrow,
    });

    // La card del contratto: ancora niente crediti e nessuno del cliente in Mi Floral Care.
    const card = page.getByTestId('assistant-credits-card');
    await expect(card.getByTestId('assistant-credits-given')).toHaveText('0');
    await expect(card.getByText(/Nadie de este cliente entra a Mi Floral Care/)).toBeVisible();
    await card.getByLabel('Créditos').fill('3');
    await card.getByRole('button', { name: 'Dar créditos' }).click();
    await expect(page.getByText('Créditos dados.')).toBeVisible();
    await expect(card.getByTestId('assistant-credits-given')).toHaveText('3');
    await expect(card.getByTestId('assistant-credits-remaining')).toHaveText('3');

    // La persona invitata entra in Mi Floral Care.
    const email = uniqueEmail('asistente');
    const invitePath = await inviteFromContract(page, email);
    const { visitor, person, portalUrl } = await acceptInviteAsNewPerson(browser, {
      invitePath,
      email,
      name: 'Lucía Plantas',
    });
    const section = person.getByTestId('my-assistant');
    await expect(section.getByTestId('my-assistant-credits')).toHaveText('Te quedan 3 consultas');
    await section.getByRole('link', { name: 'Nueva consulta' }).click();
    await expect(person).toHaveURL(/\/asistente$/);
    await expect(
      person.getByRole('heading', { level: 1, name: 'Asistente de plantas' }),
    ).toBeVisible();
    await expect(person.getByTestId('assistant-simulated')).toContainText('Simulación');

    // Senza foto non parte; con la foto si apre il caso, e l'analisi non usa consultas.
    const photo = person.getByTestId('assistant-photo');
    await photo.getByRole('button', { name: 'Analizar foto' }).click();
    await expect(photo.getByText('Elige una foto.')).toBeVisible();
    await photo.getByLabel('¿Qué planta es?').selectOption({ label: 'Potos en jardinera' });
    await photo.getByTestId('assistant-photo-input').setInputFiles('e2e/fixtures/ramo.jpg');
    await expect(photo.getByRole('img', { name: 'Vista previa de la foto elegida' })).toBeVisible();
    await photo.getByRole('button', { name: 'Analizar foto' }).click();
    await expect(person).toHaveURL(/\/asistente\?caso=[0-9a-f-]{36}$/);
    await expect(
      person.getByRole('img', { name: 'Foto de la planta de la consulta' }),
    ).toBeVisible();
    await expect(person.getByText(/Simulación: hojas con puntas secas/)).toBeVisible();
    await expect(person.getByTestId('assistant-credits')).toHaveText('Te quedan 3 consultas');

    // La foto mostra un problema: «Tiene un problema» è proposto; si sceglie «Cómo cuidarla».
    const ask = person.getByTestId('assistant-ask');
    await expect(ask.getByRole('radio', { name: /Tiene un problema/ })).toBeChecked();
    await expect(ask.getByRole('radio', { name: /Aglaonema/ })).toBeChecked();
    await ask.getByRole('radio', { name: /Cómo cuidarla/ }).check();
    await ask.getByLabel('Tu pregunta').fill('¿Cada cuándo la riego y dónde la pongo?');
    await expect(ask.getByText('Quedan 3 preguntas sobre esta foto.')).toBeVisible();
    // «Otra» senza scegliere la pianta non parte.
    await ask.getByRole('radio', { name: 'Otra' }).check();
    await ask.getByRole('button', { name: 'Preguntar' }).click();
    await expect(ask.getByText('Elige la planta de la lista.')).toBeVisible();
    await ask.getByLabel('¿Cuál?').selectOption({ label: 'Teléfono (Epipremnum aureum)' });
    await ask.getByRole('button', { name: 'Preguntar' }).click();
    await expect(person.getByText('Respuesta lista.')).toBeVisible();

    const answers = person.getByTestId('assistant-answer');
    await expect(answers).toHaveCount(1);
    const first = answers.first();
    await expect(first.getByText(/Cómo cuidarla/)).toBeVisible();
    await expect(first.getByText('Planta: Teléfono')).toBeVisible();
    await expect(first.getByText(/respuesta de prueba a «¿Cada cuándo la riego/)).toBeVisible();
    await expect(first.getByText('Revisa la humedad de la tierra con el dedo.')).toBeVisible();
    await expect(first.getByTestId('assistant-toxicity')).toContainText(
      'Tóxica para perros y gatos si la muerden o se la comen.',
    );
    await expect(
      first.getByText('Respuesta generada con IA: revísala antes de actuar.'),
    ).toBeVisible();
    await expect(person.getByTestId('assistant-credits')).toHaveText('Te quedan 2 consultas');
    // «Otra pregunta»: tipo e specie restano, il campo della domanda è vuoto.
    await expect(ask.getByLabel('Otra pregunta')).toHaveValue('');
    await expect(ask.getByRole('radio', { name: /Cómo cuidarla/ })).toBeChecked();
    await expectFitsAt320(person, 'assistant-case');

    // «Enviar a la florería»: il caso va nel filo dei messaggi del contratto.
    await person
      .getByTestId('assistant-share')
      .getByRole('button', { name: 'Enviar a la florería' })
      .click();
    await expect(person.getByText('Enviado a tu florería: lo verás en Mensajes.')).toBeVisible();
    await person.goto(portalUrl);
    await expect(
      person.getByTestId('my-care-messages').getByText(/Consulta al Asistente de plantas/),
    ).toBeVisible();
    await expect(person.getByTestId('my-assistant-credits')).toHaveText('Te quedan 2 consultas');
    await expectFitsAt320(person, 'assistant-contract');
    await visitor.close();

    // La fioreria: 1 consulta usata, 2 rimaste; il caso nel filo, mai le domande nella card.
    await page.goto(contractUrl);
    await expect(card.getByTestId('assistant-credits-used')).toHaveText('1');
    await expect(card.getByTestId('assistant-credits-remaining')).toHaveText('2');
    await expect(card.getByText(/¿Cada cuándo la riego/)).toHaveCount(0);
    await expect(
      page.getByTestId('care-messages-card').getByText(/Pregunta: ¿Cada cuándo la riego/),
    ).toBeVisible();
    await expectFitsAt320(page, 'assistant-shop-card');

    // Fine: contratto finito, orario archiviato.
    await endContract(page, contractUrl, tomorrow);
    await archiveSlot(page, slot.label);
    await expect(page).toHaveURL(new RegExp(`${SHOP}/settings/floral-care`));
  });
});
