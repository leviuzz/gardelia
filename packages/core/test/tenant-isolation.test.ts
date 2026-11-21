/**
 * TEN-01 e dintorni: un utente del tenant A non può leggere né modificare dati del tenant B,
 * nemmeno conoscendone gli ID; ogni tentativo produce un 404 e un evento di sicurezza.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addRecipeLine,
  changeMemberRole,
  createCatalogItem,
  getCatalogItem,
  getRecipe,
  getTeam,
  inviteMember,
  listCatalogItems,
  MemoryMailer,
  removeRecipeLine,
  resolveTenantContext,
  revokeInvitation,
  setCatalogItemArchived,
  setMemberActive,
  updateCatalogItem,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
const mailer = new MemoryMailer();
const deps = { mailer, appUrl: 'http://localhost:3000' };

let shopA: TestShop;
let shopB: TestShop;
let itemB: CatalogItemDto;
let bouquetA: CatalogItemDto;
let bouquetB: CatalogItemDto;
let ingredientA: CatalogItemDto;

async function securityEventsFor(entityId: string) {
  return withSystemContext(db, { reason: 'test: read security events' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
}

beforeAll(async () => {
  shopA = await createTestShop('Florería A');
  shopB = await createTestShop('Florería B');
  itemB = await createCatalogItem(
    shopB.owner,
    itemInput({ name: 'Rosa secreta de B', costMinor: 999 }),
  );
  bouquetB = await createCatalogItem(
    shopB.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo B',
      saleUnit: 'PIECE',
      priceMinor: 50000,
      costMinor: null,
      variety: null,
    }),
  );
  ingredientA = await createCatalogItem(shopA.owner, itemInput({ name: 'Rosa de A' }));
  bouquetA = await createCatalogItem(
    shopA.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo A',
      saleUnit: 'PIECE',
      priceMinor: 60000,
      costMinor: null,
      variety: null,
    }),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('accesso al tenant', () => {
  it('un utente di A non ottiene un contesto per lo slug di B (e viene registrato)', async () => {
    const ctx = await resolveTenantContext({
      userId: shopA.tenant.owner.id,
      slug: shopB.tenant.slug,
    });
    expect(ctx).toBeNull();
    const events = await securityEventsFor(shopB.tenant.tenantId);
    expect(
      events.some(
        (e) =>
          e.action === 'security.tenant_access_denied' && e.actorUserId === shopA.tenant.owner.id,
      ),
    ).toBe(true);
  });

  it('uno slug inesistente restituisce null senza eventi', async () => {
    const ctx = await resolveTenantContext({
      userId: shopA.tenant.owner.id,
      slug: 'no-existe-esta-floreria',
    });
    expect(ctx).toBeNull();
  });

  it('input malformati non arrivano al database', async () => {
    expect(
      await resolveTenantContext({ userId: 'not-a-uuid', slug: shopA.tenant.slug }),
    ).toBeNull();
    expect(
      await resolveTenantContext({ userId: shopA.tenant.owner.id, slug: "x'; DROP TABLE" }),
    ).toBeNull();
  });
});

describe('catalogo: isolamento A ↔ B', () => {
  it('l’elenco di A non contiene articoli di B', async () => {
    const list = await listCatalogItems(shopA.owner, { status: 'ACTIVE' });
    expect(list.items.map((i) => i.id)).not.toContain(itemB.id);
    expect(list.items.every((i) => i.name !== 'Rosa secreta de B')).toBe(true);
  });

  it('GET di un articolo di B dal contesto di A → 404 + evento cross-tenant', async () => {
    await expect(getCatalogItem(shopA.staff, itemB.id)).rejects.toBeInstanceOf(NotFoundError);
    const events = await securityEventsFor(itemB.id);
    const event = events.find((e) => e.action === 'security.cross_tenant_access_attempt');
    expect(event?.actorUserId).toBe(shopA.staff.userId);
    expect(event?.metadata).toMatchObject({
      actorTenantId: shopA.tenant.tenantId,
      targetTenantId: shopB.tenant.tenantId,
    });
  });

  it('PATCH e archiviazione di un articolo di B dal contesto di A → 404, B invariato', async () => {
    await expect(
      updateCatalogItem(shopA.owner, itemB.id, itemInput({ name: 'Hackeado' })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCatalogItemArchived(shopA.owner, itemB.id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const unchanged = await getCatalogItem(shopB.owner, itemB.id);
    expect(unchanged.name).toBe('Rosa secreta de B');
    expect(unchanged.status).toBe('ACTIVE');
  });

  it('la distinta di un bouquet di B non è leggibile né modificabile da A', async () => {
    await expect(getRecipe(shopA.owner, bouquetB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addRecipeLine(shopA.owner, bouquetB.id, { ingredientItemId: ingredientA.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('un bouquet di A non può usare un ingrediente di B', async () => {
    await expect(
      addRecipeLine(shopA.owner, bouquetA.id, { ingredientItemId: itemB.id, quantity: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const recipe = await getRecipe(shopA.owner, bouquetA.id);
    expect(recipe.lines).toHaveLength(0);
  });

  it('una riga di distinta di B non può essere rimossa da A', async () => {
    const ingredientB = await createCatalogItem(
      shopB.owner,
      itemInput({ name: 'Eucalipto B', type: 'FOLIAGE', saleUnit: 'BUNCH' }),
    );
    await addRecipeLine(shopB.owner, bouquetB.id, {
      ingredientItemId: ingredientB.id,
      quantity: 2,
    });
    const recipeB = await getRecipe(shopB.owner, bouquetB.id);
    const lineB = recipeB.lines[0];
    expect(lineB).toBeDefined();
    await expect(removeRecipeLine(shopA.owner, bouquetA.id, lineB!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeRecipeLine(shopA.owner, bouquetB.id, lineB!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getRecipe(shopB.owner, bouquetB.id)).lines).toHaveLength(1);
  });

  it('anche un tenantId manomesso nell’input non sposta i dati verso B', async () => {
    const created = await createCatalogItem(shopA.owner, {
      ...itemInput({ name: 'Con tenant falso' }),
      tenantId: shopB.tenant.tenantId,
    });
    const owner = await withTenantContext(
      db,
      { tenantId: shopA.tenant.tenantId, userId: null },
      (tx) => tx.catalogItem.findUnique({ where: { id: created.id }, select: { tenantId: true } }),
    );
    expect(owner?.tenantId).toBe(shopA.tenant.tenantId);
  });
});

describe('team: isolamento A ↔ B', () => {
  it('A non vede i membri di B', async () => {
    const team = await getTeam(shopA.owner);
    const userIds = team.members.map((m) => m.userId);
    expect(userIds).not.toContain(shopB.tenant.owner.id);
    expect(userIds).not.toContain(shopB.managerUser.id);
  });

  it('A non può cambiare ruolo o disattivare membri di B', async () => {
    const teamB = await getTeam(shopB.owner);
    const managerB = teamB.members.find((m) => m.userId === shopB.managerUser.id);
    expect(managerB).toBeDefined();
    await expect(
      changeMemberRole(shopA.owner, managerB!.membershipId, { role: 'STAFF' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setMemberActive(shopA.owner, managerB!.membershipId, false),
    ).rejects.toBeInstanceOf(NotFoundError);
    const after = await getTeam(shopB.owner);
    expect(after.members.find((m) => m.userId === shopB.managerUser.id)).toMatchObject({
      role: 'MANAGER',
      status: 'ACTIVE',
    });
  });

  it('A non può revocare inviti di B', async () => {
    const invite = await inviteMember(
      shopB.owner,
      { email: `nuevo-${Date.now()}@test.floral.local`, role: 'STAFF' },
      deps,
    );
    await expect(revokeInvitation(shopA.owner, invite.invitationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const teamB = await getTeam(shopB.owner);
    expect(teamB.invitations.map((i) => i.id)).toContain(invite.invitationId);
  });
});

describe('permessi per ruolo (stesso tenant)', () => {
  it('lo staff non può creare né modificare articoli', async () => {
    await expect(createCatalogItem(shopA.staff, itemInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateCatalogItem(shopA.staff, ingredientA.id, itemInput({ name: 'Cambio' })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCatalogItemArchived(shopA.staff, ingredientA.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('lo staff non vede costi né margini', async () => {
    const list = await listCatalogItems(shopA.staff, {});
    expect(list.canViewCosts).toBe(false);
    expect(list.items.every((i) => i.costMinor === null)).toBe(true);
    const item = await getCatalogItem(shopA.staff, ingredientA.id);
    expect(item.costMinor).toBeNull();
    const recipe = await getRecipe(shopA.staff, bouquetA.id);
    expect(recipe.costing).toBeNull();
    // Il proprietario invece vede il costo.
    expect((await getCatalogItem(shopA.owner, ingredientA.id)).costMinor).toBe(1400);
  });

  it('lo staff non vede il team', async () => {
    await expect(getTeam(shopA.staff)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('il manager invita solo staff e non gestisce i ruoli', async () => {
    await expect(
      inviteMember(shopA.manager, { email: 'socio@test.floral.local', role: 'OWNER' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await inviteMember(
      shopA.manager,
      { email: `staff-${Date.now()}@test.floral.local`, role: 'STAFF' },
      deps,
    );
    expect(ok.emailSent).toBe(true);
    const team = await getTeam(shopA.owner);
    const staff = team.members.find((m) => m.userId === shopA.staffUser.id);
    await expect(
      changeMemberRole(shopA.manager, staff!.membershipId, { role: 'MANAGER' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('un membro disattivato perde subito l’accesso al tenant', async () => {
    const user = await createTestUser(db);
    const invite = await inviteMember(shopA.owner, { email: user.email, role: 'STAFF' }, deps);
    expect(invite.emailSent).toBe(true);
    const token = /\/invite\/([\w-]+)/.exec(mailer.lastTo(user.email)?.text ?? '')?.[1];
    expect(token).toBeDefined();
    const { acceptInvitation } = await import('../src/index');
    await acceptInvitation({ token: token!, userId: user.id, userEmail: user.email });
    expect(await resolveTenantContext({ userId: user.id, slug: shopA.tenant.slug })).not.toBeNull();

    const team = await getTeam(shopA.owner);
    const membership = team.members.find((m) => m.userId === user.id)!;
    await setMemberActive(shopA.owner, membership.membershipId, false);
    expect(await resolveTenantContext({ userId: user.id, slug: shopA.tenant.slug })).toBeNull();
  });
});
