import { expect, test } from '@playwright/test';

/**
 * Clienti con le loro date speciali (compleanni, anniversari, altre date) inserite già nel
 * modulo "Nuevo cliente": si salvano insieme al cliente, con gli errori sulla riga giusta.
 * Cronologia (CRM-01): il preventivo creato dalla scheda compare nell'"Historial" col suo link.
 * Etichette e filtri (CRM-01, ADR-070): un'etichetta a più clienti insieme e i filtri della lista.
 */
test.describe('nuovo cliente con date speciali', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('si aggiungono le date nel modulo; un errore resta sulla sua riga', async ({ page }) => {
    const name = `Cliente con fechas ${Date.now()}`;
    await page.goto('/app/las-camelias/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await expect(page.getByText('Sin fechas registradas.')).toBeVisible();

    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const first = page.getByRole('group', { name: 'Fecha 1' });
    await first.getByRole('spinbutton', { name: 'Día', exact: true }).fill('14');
    await first
      .getByRole('combobox', { name: 'Mes', exact: true })
      .selectOption({ label: 'diciembre' });
    await first.getByLabel('Año (opcional)').fill('1990');

    // Seconda data personalizzata senza nome: il server la rifiuta e lo dice su quella riga.
    await page.getByRole('button', { name: 'Agregar fecha' }).click();
    const second = page.getByRole('group', { name: 'Fecha 2' });
    await second
      .getByRole('combobox', { name: 'Tipo', exact: true })
      .selectOption({ label: 'Otra fecha' });
    await second.getByRole('spinbutton', { name: 'Día', exact: true }).fill('21');
    await second
      .getByRole('combobox', { name: 'Mes', exact: true })
      .selectOption({ label: 'junio' });
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(second.getByText('Este campo es obligatorio.')).toBeVisible();
    await expect(first.getByRole('spinbutton', { name: 'Día', exact: true })).toHaveValue('14');

    await second.getByRole('textbox', { name: 'Nombre de la fecha' }).fill('Día del padre');
    await second.getByLabel('¿De quién es?').fill('Su papá');
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByText('14 de diciembre de 1990')).toBeVisible();
    await expect(page.getByText('Día del padre')).toBeVisible();
    await expect(page.getByText('de Su papá')).toBeVisible();
  });
});

test.describe('cronologia del cliente', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('il preventivo creato dalla scheda compare nell’historial, col suo link', async ({
    page,
  }) => {
    // "Zoila …": in fondo alle liste per nome, così non sposta i clienti del seed usati da altri test.
    const name = `Zoila Historial ${Date.now()}`;
    await page.goto('/app/las-camelias/customers/new');
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Crear cliente' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    const customerUrl = page.url().replace(/\?.*$/, '');
    const history = page.getByRole('region', { name: 'Historial' });
    await expect(history.getByText('Cliente registrado')).toBeVisible();

    await page.getByRole('link', { name: 'Nueva cotización' }).click();
    await page.getByRole('button', { name: 'Crear cotización' }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    const heading = await page.getByRole('heading', { level: 1 }).textContent();
    const number = /COT-\d+/.exec(heading ?? '')?.[0];
    expect(number).toBeTruthy();

    await page.goto(customerUrl);
    const created = history.getByRole('link', { name: `Cotización ${number} creada` });
    await expect(created).toBeVisible();
    await created.click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number ?? 'COT-');
  });
});

test.describe('etichette e filtri dei clienti', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  const MONTHS = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];

  test('etichetta a più clienti; filtri per etichetta, data vicina e consenso', async ({
    page,
  }) => {
    const stamp = Date.now();
    const tag = `e2e-${stamp}`;
    const ana = `Etiqueta Ana ${stamp}`;
    const beto = `Etiqueta Beto ${stamp}`;
    const list = `/app/las-camelias/customers?q=${stamp}`;

    // Ana con un compleanno fra tre giorni; Beto senza date. Nessuno dei due accetta promozioni.
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    for (const name of [ana, beto]) {
      await page.goto('/app/las-camelias/customers/new');
      await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
      if (name === ana) {
        await page.getByRole('button', { name: 'Agregar fecha' }).click();
        const date = page.getByRole('group', { name: 'Fecha 1' });
        await date
          .getByRole('spinbutton', { name: 'Día', exact: true })
          .fill(String(soon.getUTCDate()));
        await date
          .getByRole('combobox', { name: 'Mes', exact: true })
          .selectOption({ label: MONTHS[soon.getUTCMonth()] ?? 'enero' });
      }
      await page.getByRole('button', { name: 'Crear cliente' }).click();
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }

    await page.goto(list);
    await expect(page.getByText('2 clientes', { exact: true })).toBeVisible();
    const bulk = page.getByRole('form', { name: 'Etiquetar clientes' });
    const tagInput = bulk.getByRole('combobox', { name: 'Etiqueta', exact: true });

    // Senza clienti scelti non si salva nulla: lo dice nella barra.
    await tagInput.fill(tag);
    await bulk.getByRole('button', { name: 'Agregar etiqueta' }).click();
    await expect(bulk.getByText('Selecciona al menos un cliente.')).toBeVisible();

    await bulk.getByRole('button', { name: 'Seleccionar todos' }).click();
    await expect(bulk.getByText('2 clientes seleccionados')).toBeVisible();
    await bulk.getByRole('button', { name: 'Agregar etiqueta' }).click();
    await expect(page.getByText(`Etiqueta «${tag}» agregada a 2 clientes.`)).toBeVisible();
    await expect(bulk.getByText('Elige clientes de la lista')).toBeVisible();
    await expect(tagInput).toHaveValue('');

    // Filtro per etichetta dalla barra dei filtri.
    await page.getByRole('combobox', { name: 'Filtrar por etiqueta' }).selectOption(tag);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(new RegExp(`tag=${tag}`));
    await expect(page.getByText('2 clientes', { exact: true })).toBeVisible();

    // Si toglie a Beto: esce dalla lista filtrata.
    await bulk.getByRole('checkbox', { name: `Seleccionar a ${beto}` }).check();
    await expect(bulk.getByText('1 cliente seleccionado')).toBeVisible();
    await tagInput.fill(tag);
    await bulk.getByRole('button', { name: 'Quitar etiqueta' }).click();
    await expect(page.getByText(`Etiqueta «${tag}» quitada a 1 cliente.`)).toBeVisible();
    await expect(page.getByText('1 cliente', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(beto) })).toHaveCount(0);

    // Fecha especial próxima: solo Ana. Consenso: nessuno dei due.
    await page.goto(`${list}&upcoming=1`);
    await expect(page.getByRole('link', { name: new RegExp(ana) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(beto) })).toHaveCount(0);
    await page.goto(`${list}&consent=yes`);
    await expect(page.getByText('No hay clientes con estos filtros')).toBeVisible();
  });
});
