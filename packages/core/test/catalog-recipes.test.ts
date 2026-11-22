import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  ConflictError,
  ValidationError,
  addRecipeLine,
  createCatalogItem,
  getRecipe,
  listCanonicalFlowers,
  listCatalogItems,
  listIngredientOptions,
  removeRecipeLine,
  setCatalogItemArchived,
  updateCatalogItem,
  updateRecipeDetails,
  updateRecipeLineQuantity,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

let shop: TestShop;

beforeAll(async () => {
  shop = await createTestShop();
});

afterAll(async () => {
  await disconnectDb();
});

async function auditActions(entityId: string): Promise<string[]> {
  const entries = await withTenantContext(getDb(), shop.owner, (tx) =>
    tx.auditLog.findMany({
      where: { tenantId: shop.owner.tenantId, entityId },
      orderBy: { createdAt: 'asc' },
    }),
  );
  return entries.map((e) => e.action);
}

describe('catalogo CRUD', () => {
  it('crea un articolo con la valuta del tenant e registra l’audit', async () => {
    const item = await createCatalogItem(shop.manager, itemInput({ sku: 'ROS-01' }));
    expect(item.currency).toBe('MXN');
    expect(item.priceMinor).toBe(3500);
    expect(await auditActions(item.id)).toEqual(['catalog_item.created']);
  });

  it('impedisce SKU duplicati nello stesso tenant ma non fra tenant diversi', async () => {
    await createCatalogItem(shop.owner, itemInput({ sku: 'DUP-1' }));
    await expect(createCatalogItem(shop.owner, itemInput({ sku: 'DUP-1' }))).rejects.toMatchObject({
      reason: 'sku_taken',
    });
    const other = await createTestShop();
    await expect(
      createCatalogItem(other.owner, itemInput({ sku: 'DUP-1' })),
    ).resolves.toMatchObject({ sku: 'DUP-1' });
  });

  it('rivalida lato server l’input (anche se non arriva dal form)', async () => {
    await expect(
      createCatalogItem(shop.owner, itemInput({ priceMinor: -100 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCatalogItem(shop.owner, itemInput({ type: 'SERVICE', saleUnit: 'STEM' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCatalogItem(shop.owner, itemInput({ priceMinor: 12.5 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('le specie arrivano pronte per la ricerca nella lingua di chi usa l’app (ADR-043)', async () => {
    const italian = await listCanonicalFlowers('it-IT');
    const clavel = italian.find((flower) => flower.slug === 'clavel');
    expect(clavel?.name).toBe('Garofano');
    expect(clavel?.localTerms.map((term) => term.key)).toContain('garofano');
    expect(clavel?.otherTerms.map((term) => term.key)).toEqual(
      expect.arrayContaining(['clavel', 'carnation']),
    );
    const spanish = await listCanonicalFlowers('es-MX');
    const nube = spanish.find((flower) => flower.slug === 'gypsophila');
    expect(nube?.localTerms.map((term) => term.text)).toContain('Nube');
    // In ordine alfabetico nella lingua richiesta.
    const names = spanish.map((flower) => flower.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es-MX')));
  });

  it('collega la tassonomia solo se la categoria è coerente', async () => {
    const flowers = await listCanonicalFlowers('es-MX');
    const rosa = flowers.find((f) => f.slug === 'rosa');
    const eucalipto = flowers.find((f) => f.slug === 'eucalipto');
    expect(rosa?.name).toBe('Rosa');
    const ok = await createCatalogItem(shop.owner, itemInput({ canonicalFlowerId: rosa!.id }));
    expect(ok.canonicalName).toBe('Rosa');
    await expect(
      createCatalogItem(shop.owner, itemInput({ canonicalFlowerId: eucalipto!.id })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('aggiorna registrando solo i campi cambiati; la tipologia è immutabile', async () => {
    const item = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Tulipán', priceMinor: 5000 }),
    );
    await updateCatalogItem(shop.owner, item.id, itemInput({ name: 'Tulipán', priceMinor: 5500 }));
    const entries = await withTenantContext(getDb(), shop.owner, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.owner.tenantId, entityId: item.id, action: 'catalog_item.updated' },
      }),
    );
    expect(entries).toHaveLength(1);
    const metadata = entries[0]?.metadata as { name: string; changes: Record<string, unknown> };
    // `name` è l'etichetta per il feed attività; nel diff compare solo ciò che è cambiato.
    expect(metadata.name).toBe('Tulipán');
    expect(metadata.changes).toEqual({ priceMinor: { from: 5000, to: 5500 } });
    await expect(
      updateCatalogItem(shop.owner, item.id, itemInput({ type: 'FOLIAGE', saleUnit: 'BUNCH' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('archivia e ripristina senza cancellare', async () => {
    const item = await createCatalogItem(shop.owner, itemInput({ name: 'Clavel' }));
    await setCatalogItemArchived(shop.owner, item.id, true);
    const active = await listCatalogItems(shop.owner, { status: 'ACTIVE' });
    const archived = await listCatalogItems(shop.owner, { status: 'ARCHIVED' });
    expect(active.items.map((i) => i.id)).not.toContain(item.id);
    expect(archived.items.map((i) => i.id)).toContain(item.id);
    const restored = await setCatalogItemArchived(shop.owner, item.id, false);
    expect(restored.status).toBe('ACTIVE');
    expect(await auditActions(item.id)).toEqual([
      'catalog_item.created',
      'catalog_item.archived',
      'catalog_item.restored',
    ]);
  });

  it('filtra per testo, tipologia e disponibilità, con paginazione', async () => {
    const local = await createTestShop();
    for (let i = 0; i < 23; i += 1) {
      await createCatalogItem(
        local.owner,
        itemInput({ name: `Girasol ${String(i).padStart(2, '0')}` }),
      );
    }
    await createCatalogItem(
      local.owner,
      itemInput({
        name: 'Eucalipto',
        type: 'FOLIAGE',
        saleUnit: 'BUNCH',
        availability: 'OUT_OF_STOCK',
      }),
    );
    const page1 = await listCatalogItems(local.owner, { q: 'girasol' });
    expect(page1.total).toBe(23);
    expect(page1.items).toHaveLength(20);
    expect(page1.pageCount).toBe(2);
    const page2 = await listCatalogItems(local.owner, { q: 'GIRASOL', page: '2' });
    expect(page2.items).toHaveLength(3);
    const foliage = await listCatalogItems(local.owner, {
      type: 'FOLIAGE',
      availability: 'OUT_OF_STOCK',
    });
    expect(foliage.items.map((i) => i.name)).toEqual(['Eucalipto']);
    const beyond = await listCatalogItems(local.owner, { page: '99' });
    expect(beyond.page).toBe(beyond.pageCount);
  });
});

describe('distinta base dei bouquet', () => {
  it('un nuovo bouquet nasce con distinta vuota; righe, costi e margini sono deterministici (BQ-01)', async () => {
    const rose = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
    );
    const paper = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Papel kraft',
        type: 'PACKAGING',
        saleUnit: 'PIECE',
        priceMinor: 3000,
        costMinor: 800,
        colors: [],
        variety: null,
      }),
    );
    const bouquet = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Ramo 12 rosas',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        priceMinor: 69000,
        costMinor: null,
        variety: null,
      }),
    );
    expect(bouquet.recipeLineCount).toBe(0);

    await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 12 });
    await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: paper.id, quantity: 1 });
    await updateRecipeDetails(shop.owner, bouquet.id, {
      laborCostMinor: 6000,
      styleTags: ['clásico'],
      notes: null,
      substitutionPolicy: 'ASK_CUSTOMER',
    });

    const recipe = await getRecipe(shop.owner, bouquet.id);
    expect(recipe.lines.map((l) => [l.ingredient.name, l.quantity])).toEqual([
      ['Rosa roja', 12],
      ['Papel kraft', 1],
    ]);
    expect(recipe.costing).toMatchObject({
      componentsRetailMinor: 12 * 3500 + 3000,
      materialCostMinor: 12 * 1400 + 800,
      totalCostMinor: 12 * 1400 + 800 + 6000,
      materialMarginMinor: 69000 - (12 * 1400 + 800),
    });

    // Cambiare la quantità cambia il costo in modo coerente.
    const roseLine = recipe.lines[0]!;
    await updateRecipeLineQuantity(shop.owner, bouquet.id, roseLine.id, 7);
    const after = await getRecipe(shop.owner, bouquet.id);
    expect(after.costing?.materialCostMinor).toBe(7 * 1400 + 800);

    await removeRecipeLine(shop.owner, bouquet.id, roseLine.id);
    expect((await getRecipe(shop.owner, bouquet.id)).lines).toHaveLength(1);
  });

  it('segnala costi mancanti invece di mostrare margini falsi', async () => {
    const noCost = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Nube', costMinor: null, saleUnit: 'BUNCH' }),
    );
    const bouquet = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Ramo nube',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        priceMinor: 40000,
        costMinor: null,
        variety: null,
      }),
    );
    await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: noCost.id, quantity: 2 });
    const recipe = await getRecipe(shop.owner, bouquet.id);
    expect(recipe.costing?.linesMissingCost).toBe(1);
    expect(recipe.costing?.materialMarginBps).toBeNull();
  });

  it('rifiuta duplicati, quantità non valide, tipi non ammessi e articoli che non sono bouquet', async () => {
    const rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa duplicada' }));
    const service = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Visita',
        type: 'SERVICE',
        saleUnit: 'SERVICE',
        colors: [],
        variety: null,
      }),
    );
    const bouquet = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Ramo X',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        priceMinor: 10000,
        costMinor: null,
        variety: null,
      }),
    );
    await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 3 });
    await expect(
      addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 1 }),
    ).rejects.toMatchObject({ reason: 'ingredient_already_in_recipe' });
    await expect(
      addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: service.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addRecipeLine(shop.owner, rose.id, { ingredientItemId: rose.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('un ingrediente archiviato resta nella distinta ma viene segnalato e non è più selezionabile', async () => {
    const lily = await createCatalogItem(shop.owner, itemInput({ name: 'Lilium temporal' }));
    const bouquet = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Ramo lilium',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        priceMinor: 30000,
        costMinor: null,
        variety: null,
      }),
    );
    await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: lily.id, quantity: 4 });
    await setCatalogItemArchived(shop.owner, lily.id, true);
    const recipe = await getRecipe(shop.owner, bouquet.id);
    expect(recipe.lines).toHaveLength(1);
    expect(recipe.hasUnavailableIngredients).toBe(true);
    const options = await listIngredientOptions(shop.owner);
    expect(options.map((o) => o.id)).not.toContain(lily.id);
    expect(options.every((o) => o.type !== 'BOUQUET' && o.type !== 'SERVICE')).toBe(true);
  });
});
