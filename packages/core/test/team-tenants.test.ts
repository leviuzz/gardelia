import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  ValidationError,
  acceptInvitation,
  changeMemberRole,
  createTenant,
  getDashboard,
  getInvitationPreview,
  getTeam,
  getTenantSettings,
  inviteMember,
  listUserTenants,
  resolveTenantContext,
  revokeInvitation,
  setMemberActive,
  updatePrimaryLocation,
  updateTenantLegal,
  updateTenantProfile,
} from '../src/index';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

const db = getDb();
const mailer = new MemoryMailer();
const deps = { mailer, appUrl: 'http://localhost:3000/' };

function tokenFromEmail(email: string): string {
  const text = mailer.lastTo(email)?.text ?? '';
  const token = /\/invite\/([\w-]+)/.exec(text)?.[1];
  if (!token) throw new Error(`Nessun invito inviato a ${email}`);
  return token;
}

const onboardingData = {
  displayName: 'Florería El Jardín',
  legalName: '',
  taxId: '',
  contactEmail: 'hola@eljardin.test',
  contactPhone: '449 555 0199',
  timezone: 'America/Mexico_City',
  location: {
    addressLine1: 'Calle Morelos 45',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    phone: '',
    deliveryRadiusKm: '5',
  },
};

let shop: TestShop;

beforeAll(async () => {
  shop = await createTestShop();
});

afterAll(async () => {
  await disconnectDb();
});

describe('onboarding della fioreria', () => {
  it('crea tenant, proprietario e sede principale; lo slug collidente riceve un suffisso', async () => {
    const userA = await createTestUser(db);
    const userB = await createTestUser(db);
    const unique = `Florería Prueba ${Date.now()}`;
    const first = await createTenant({
      userId: userA.id,
      country: 'MX',
      data: { ...onboardingData, displayName: unique },
    });
    const second = await createTenant({
      userId: userB.id,
      country: 'MX',
      data: { ...onboardingData, displayName: unique },
    });
    expect(second.slug).toBe(`${first.slug}-2`);

    const ctx = await contextFor(userA.id, first.slug);
    expect(ctx.role).toBe('OWNER');
    expect(ctx.currency).toBe('MXN');
    const settings = await getTenantSettings(ctx);
    expect(settings.tenant.contactPhone).toBe('+524495550199');
    expect(settings.location).toMatchObject({
      city: 'Aguascalientes',
      region: 'AGU',
      deliveryRadiusKm: 5,
    });
    expect(await listUserTenants(userA.id)).toEqual([
      { slug: first.slug, displayName: unique, role: 'OWNER', mode: 'LIVE' },
    ]);
    // L'altro utente non vede la prima fioreria.
    expect(await resolveTenantContext({ userId: userB.id, slug: first.slug })).toBeNull();
  });

  it('valida i dati e limita il numero di fiorerie per utente', async () => {
    const user = await createTestUser(db);
    await expect(
      createTenant({
        userId: user.id,
        country: 'MX',
        data: { ...onboardingData, displayName: '' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTenant({ userId: user.id, country: 'IT', data: onboardingData }),
    ).rejects.toBeInstanceOf(ValidationError);
    for (let i = 0; i < 5; i += 1) {
      await createTenant({
        userId: user.id,
        country: 'MX',
        data: { ...onboardingData, displayName: `Limite ${Date.now()} ${i}` },
      });
    }
    await expect(
      createTenant({ userId: user.id, country: 'MX', data: onboardingData }),
    ).rejects.toMatchObject({ reason: 'tenant_limit_reached' });
  });
});

describe('impostazioni', () => {
  it('owner e manager modificano il profilo; solo l’owner i dati legali', async () => {
    await updateTenantProfile(shop.manager, {
      displayName: 'Nuevo Nombre',
      contactEmail: '',
      contactPhone: '',
      timezone: 'America/Cancun',
    });
    const settings = await getTenantSettings(shop.owner);
    expect(settings.tenant).toMatchObject({
      displayName: 'Nuevo Nombre',
      timezone: 'America/Cancun',
    });
    await expect(
      updateTenantLegal(shop.manager, { legalName: 'X', taxId: '' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateTenantProfile(shop.staff, { displayName: 'Staff', timezone: 'America/Cancun' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await updateTenantLegal(shop.owner, {
      legalName: 'Flores Prueba S.A.S.',
      taxId: 'FPR190312AB1',
    });
    await expect(
      updateTenantLegal(shop.owner, { legalName: '', taxId: 'NO-VALIDO' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updatePrimaryLocation(shop.owner, {
      addressLine1: 'Nueva 1',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20010',
      deliveryRadiusKm: '',
    });
    expect((await getTenantSettings(shop.owner)).location).toMatchObject({
      addressLine1: 'Nueva 1',
      postalCode: '20010',
      deliveryRadiusKm: null,
    });
  });
});

describe('inviti', () => {
  it('flusso completo: invito → email con link → anteprima → accettazione', async () => {
    const invitee = await createTestUser(db);
    const result = await inviteMember(
      shop.owner,
      { email: invitee.email.toUpperCase(), role: 'MANAGER' },
      deps,
    );
    expect(result.emailSent).toBe(true);
    const email = mailer.lastTo(invitee.email);
    expect(email?.subject).toContain(shop.owner.tenantName);
    expect(email?.html).toContain('http://localhost:3000/invite/');

    const token = tokenFromEmail(invitee.email);
    const preview = await getInvitationPreview(token);
    expect(preview).toMatchObject({
      status: 'PENDING',
      role: 'MANAGER',
      email: invitee.email,
      tenantSlug: shop.tenant.slug,
    });

    const accepted = await acceptInvitation({
      token,
      userId: invitee.id,
      userEmail: invitee.email,
    });
    expect(accepted.tenantSlug).toBe(shop.tenant.slug);
    const ctx = await contextFor(invitee.id, shop.tenant.slug);
    expect(ctx.role).toBe('MANAGER');
    // Idempotente.
    await expect(
      acceptInvitation({ token, userId: invitee.id, userEmail: invitee.email }),
    ).resolves.toEqual(accepted);
    expect((await getInvitationPreview(token)).status).toBe('ACCEPTED');
  });

  it('solo l’indirizzo invitato può accettare', async () => {
    const invitee = await createTestUser(db);
    const other = await createTestUser(db);
    await inviteMember(shop.owner, { email: invitee.email, role: 'STAFF' }, deps);
    const token = tokenFromEmail(invitee.email);
    await expect(
      acceptInvitation({ token, userId: other.id, userEmail: other.email }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await resolveTenantContext({ userId: other.id, slug: shop.tenant.slug })).toBeNull();
  });

  it('un invito revocato o sostituito non è più valido', async () => {
    const invitee = await createTestUser(db);
    const first = await inviteMember(shop.owner, { email: invitee.email, role: 'STAFF' }, deps);
    const firstToken = tokenFromEmail(invitee.email);
    await inviteMember(shop.owner, { email: invitee.email, role: 'STAFF' }, deps); // sostituisce il primo
    expect((await getInvitationPreview(firstToken)).status).toBe('REVOKED');
    await expect(revokeInvitation(shop.owner, first.invitationId)).rejects.toMatchObject({
      reason: 'invitation_not_pending',
    });

    const secondToken = tokenFromEmail(invitee.email);
    const team = await getTeam(shop.owner);
    const pending = team.invitations.find((i) => i.email === invitee.email);
    await revokeInvitation(shop.owner, pending!.id);
    await expect(
      acceptInvitation({ token: secondToken, userId: invitee.id, userEmail: invitee.email }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('un invito scaduto non può essere accettato', async () => {
    const invitee = await createTestUser(db);
    const { invitationId } = await inviteMember(
      shop.owner,
      { email: invitee.email, role: 'STAFF' },
      deps,
    );
    const token = tokenFromEmail(invitee.email);
    await withTenantContext(db, shop.owner, (tx) =>
      tx.invitation.update({
        where: { id: invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    expect((await getInvitationPreview(token)).status).toBe('EXPIRED');
    await expect(
      acceptInvitation({ token, userId: invitee.id, userEmail: invitee.email }),
    ).rejects.toMatchObject({ reason: 'invitation_expired' });
  });

  it('non si invita chi è già membro attivo; token falsi non rivelano nulla', async () => {
    await expect(
      inviteMember(shop.owner, { email: shop.staffUser.email, role: 'STAFF' }, deps),
    ).rejects.toMatchObject({ reason: 'already_member' });
    expect(await getInvitationPreview('x'.repeat(43))).toEqual({ status: 'NOT_FOUND' });
    expect(await getInvitationPreview('corto')).toEqual({ status: 'NOT_FOUND' });
  });
});

describe('ruoli e proprietari', () => {
  it('resta sempre almeno un proprietario attivo', async () => {
    const local = await createTestShop();
    const team = await getTeam(local.owner);
    const ownerMembership = team.members.find((m) => m.role === 'OWNER')!;
    // Non si può modificare sé stessi...
    await expect(
      changeMemberRole(local.owner, ownerMembership.membershipId, { role: 'STAFF' }),
    ).rejects.toMatchObject({ reason: 'self_change' });
    // ...si promuove un altro owner, che poi può declassare il primo.
    const managerMembership = team.members.find((m) => m.role === 'MANAGER')!;
    await changeMemberRole(local.owner, managerMembership.membershipId, { role: 'OWNER' });
    const secondOwner = await contextFor(local.managerUser.id, local.tenant.slug);
    await changeMemberRole(secondOwner, ownerMembership.membershipId, { role: 'MANAGER' });
    // Ora il secondo è l'unico owner: nessuno può declassarlo o disattivarlo.
    const exOwner = await contextFor(local.tenant.owner.id, local.tenant.slug);
    await expect(
      changeMemberRole(exOwner, managerMembership.membershipId, { role: 'STAFF' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setMemberActive(secondOwner, managerMembership.membershipId, false),
    ).rejects.toMatchObject({ reason: 'self_change' });
  });
});

describe('dashboard', () => {
  it('mostra dati reali del tenant e adatta il contenuto al ruolo', async () => {
    const local = await createTestShop();
    const empty = await getDashboard(local.owner);
    expect(empty.catalog.activeItems).toBe(0);
    expect(empty.onboarding.find((s) => s.key === 'first_product')?.done).toBe(false);
    expect(empty.team).toEqual({ activeMembers: 3, pendingInvitations: 0 });
    expect(empty.recentActivity).not.toBeNull();

    const staffView = await getDashboard(local.staff);
    expect(staffView.team).toBeNull();
    expect(staffView.recentActivity).toBeNull();
    expect(staffView.catalog.itemsMissingCost).toBeNull();
    expect(staffView.onboarding.map((s) => s.key)).toEqual([
      'first_product',
      'first_bouquet_recipe',
    ]);
  });
});
