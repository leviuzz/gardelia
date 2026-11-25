import { expect, test } from '@playwright/test';
import {
  addSlot,
  archiveSlot,
  createConfirmedContract,
  dayInShop,
  endContract,
  expectFitsAt320,
  saveOffer,
} from './support/floral-care';

/**
 * Floral Care, blocco 6a (ADR-085): l'Asistente de plantas della fioreria, con l'assistente
 * simulato (etichettato). Dalla pianta del contratto: foto → specie candidate → «Otra» dalla
 * lista → domanda → risposta con i passi, cura e tossicità dai nostri dati, avviso dell'IA;
 * «Otra pregunta» sullo stesso caso; contatore del giorno; la card del contratto con la consulta.
 */
test.describe('Floral Care: Asistente de plantas', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });
  test.setTimeout(90_000);

  test('dalla pianta del contratto alla risposta, con la tossicità dai nostri dati', async ({
    page,
  }) => {
    const stamp = Date.now();
    const tomorrow = dayInShop(1);
    await saveOffer(page, '24');
    const slot = await addSlot(page, tomorrow, 0);
    const { contractUrl } = await createConfirmedContract(page, {
      customer: `Oficinas Asistente ${stamp}`,
      slotLabel: slot.label,
      firstDay: tomorrow,
    });

    // La card del contratto, ancora vuota; il link della pianta apre l'assistente su quella pianta.
    const card = page.getByTestId('assistant-card');
    await expect(card.getByText('Aún no hay consultas.')).toBeVisible();
    await page
      .getByRole('link', { name: 'Preguntar al asistente sobre Potos en jardinera' })
      .click();
    await expect(page).toHaveURL(/\/assistant\?plant=[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Asistente de plantas' }),
    ).toBeVisible();
    await expect(page.getByTestId('assistant-simulated')).toContainText('Simulación');
    await expect(page.getByTestId('assistant-usage')).toHaveText(
      /Hoy: \d+ de 20 consultas de la florería/,
    );
    const usedBefore = Number(
      (await page.getByTestId('assistant-usage').textContent())?.match(/Hoy: (\d+)/)?.[1],
    );
    await expect(page.getByLabel('Planta del contrato')).toHaveValue(/[0-9a-f-]{36}/);

    // Senza foto non parte; con la foto si apre il caso.
    const photo = page.getByTestId('assistant-photo');
    await photo.getByRole('button', { name: 'Analizar foto' }).click();
    await expect(photo.getByText('Elige una foto.')).toBeVisible();
    await photo.getByTestId('assistant-photo-input').setInputFiles('e2e/fixtures/ramo.jpg');
    await expect(photo.getByRole('img', { name: 'Vista previa de la foto elegida' })).toBeVisible();
    await photo.getByRole('button', { name: 'Analizar foto' }).click();
    await expect(page).toHaveURL(/\/assistant\?case=[0-9a-f-]{36}$/);
    await expect(page.getByRole('img', { name: 'Foto de la planta de la consulta' })).toBeVisible();
    await expect(page.getByText('Lo que se ve en la foto')).toBeVisible();
    await expect(page.getByText(/Simulación: hojas con puntas secas/)).toBeVisible();

    // Le candidate del riconoscimento, poi «Otra» con la pianta giusta dalla lista.
    const ask = page.getByTestId('assistant-ask');
    await expect(ask.getByRole('radio', { name: /Aglaonema/ })).toBeChecked();
    await ask
      .getByLabel('¿Qué le pasa?')
      .fill('Tiene hojas amarillas y las puntas secas, ¿qué hago?');
    await expect(ask.getByText('Quedan 3 preguntas sobre esta foto.')).toBeVisible();
    // «Otra» senza scegliere la pianta non parte.
    await ask.getByRole('radio', { name: 'Otra' }).check();
    await ask.getByRole('button', { name: 'Preguntar' }).click();
    await expect(ask.getByText('Elige la planta de la lista.')).toBeVisible();
    await ask.getByLabel('¿Cuál?').selectOption({ label: 'Teléfono (Epipremnum aureum)' });
    await ask.getByRole('button', { name: 'Preguntar' }).click();
    await expect(page.getByText('Respuesta lista.')).toBeVisible();

    const answers = page.getByTestId('assistant-answer');
    await expect(answers).toHaveCount(1);
    const first = answers.first();
    await expect(first.getByText('Planta: Teléfono')).toBeVisible();
    await expect(first.getByText(/respuesta de prueba a «Tiene hojas amarillas/)).toBeVisible();
    await expect(first.getByText('Revisa la humedad de la tierra con el dedo.')).toBeVisible();
    await expect(first.getByText('Cuidados según Gardelia')).toBeVisible();
    await expect(first.getByTestId('assistant-toxicity')).toContainText(
      'Tóxica para perros y gatos si la muerden o se la comen.',
    );
    await expect(first.getByTestId('assistant-toxicity')).toContainText('ASPCA');
    await expect(
      first.getByText('Respuesta generada con IA: revísala antes de actuar.'),
    ).toBeVisible();
    await expect(page.getByTestId('assistant-usage')).toHaveText(
      `Hoy: ${usedBefore + 1} de 20 consultas de la florería`,
    );

    // «Otra pregunta»: la specie resta, il campo della domanda è vuoto.
    await expect(ask.getByLabel('Otra pregunta')).toHaveValue('');
    await expect(ask.getByLabel('¿Cuál?')).toHaveValue('telefono');
    await ask.getByLabel('Otra pregunta').fill('¿Y dónde la pongo dentro de la oficina?');
    await expect(ask.getByText('Quedan 2 preguntas sobre esta foto.')).toBeVisible();
    await ask.getByRole('button', { name: 'Preguntar' }).click();
    await expect(answers).toHaveCount(2);
    await expect(answers.nth(1).getByText(/«¿Y dónde la pongo/)).toBeVisible();
    await expect(ask.getByText('Queda 1 pregunta sobre esta foto.')).toBeVisible();
    await expectFitsAt320(page, 'assistant-case');

    // La card del contratto ora elenca la consulta.
    await page.goto(contractUrl);
    await expect(card.getByRole('link', { name: /Teléfono · Potos en jardinera/ })).toBeVisible();
    await expect(card.getByText(/2 respuestas/)).toBeVisible();
    await expectFitsAt320(page, 'assistant-contract');

    // Fine: contratto finito, orario archiviato.
    await endContract(page, contractUrl, tomorrow);
    await archiveSlot(page, slot.label);
  });
});
