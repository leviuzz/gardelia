import { expect, test } from '@playwright/test';

/**
 * Pagine elenco (componenti comuni della fase 0): ricerca nell'URL, "nessun risultato" distinto
 * dall'elenco vuoto, "Limpiar filtros" e paginazione che conserva i filtri. Si prova sui clienti
 * con un nome unico per esecuzione, così il risultato non dipende dagli altri test.
 */
test.describe('pagine elenco', () => {
  test.use({ storageState: 'e2e/.auth/owner.json' });

  test('ricerca, nessun risultato, pulizia dei filtri e paginazione con i filtri', async ({
    page,
  }) => {
    test.slow(); // 21 clienti creati dal form: uno più di una pagina
    const tag = `Paginacion ${Date.now()}`;
    for (let index = 1; index <= 21; index += 1) {
      await page.goto('/app/las-camelias/customers/new');
      await page
        .getByRole('textbox', { name: 'Nombre', exact: true })
        .fill(`${tag} ${String(index).padStart(2, '0')}`);
      await page.getByRole('button', { name: 'Crear cliente' }).click();
      await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
    }

    // Ricerca dal form: il filtro finisce nell'URL e il conteggio è annunciato.
    await page.goto('/app/las-camelias/customers');
    await page.getByRole('searchbox', { name: 'Buscar' }).fill(tag);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/[?&]q=Paginacion\+\d+/);
    await expect(page.getByText('21 clientes')).toBeVisible();
    const rows = page.getByRole('main').getByRole('listitem').filter({ hasText: tag });
    await expect(rows).toHaveCount(20);

    // Pagina 1: "Anterior" è disattivato davvero; "Siguiente" porta alla 2 con lo stesso filtro.
    const pager = page.getByRole('navigation', { name: 'Página 1 de 2' });
    await expect(pager.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await pager.getByRole('link', { name: 'Siguiente' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page).toHaveURL(/[?&]q=Paginacion\+\d+/);
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByRole('navigation', { name: 'Página 2 de 2' }).getByRole('button', {
        name: 'Siguiente',
      }),
    ).toBeDisabled();

    // Nessun risultato: messaggio dei filtri (non quello dell'elenco vuoto) e pulizia.
    await page.getByRole('searchbox', { name: 'Buscar' }).fill(`${tag} inexistente`);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(
      page.getByRole('heading', { name: 'No hay clientes con estos filtros' }),
    ).toBeVisible();
    await expect(page.getByText('Aún no tienes clientes')).toHaveCount(0);
    await page.getByRole('link', { name: 'Limpiar filtros' }).click();
    await expect(page).toHaveURL(/\/app\/las-camelias\/customers$/);
    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('');
  });
});
