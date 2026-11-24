import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser, type TestUser } from '@floral/db/testing';
import { AUDIT_ACTIONS } from '@floral/domain';
import { ForbiddenError, NotFoundError, ValidationError, resolveTenantContext } from '../src/index';
import { confirmUserAccess, resetUserTwoFactor } from '../src/platform';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Accesso confermato a mano dall'amministratore (ADR-050): senza dominio email verificato le
 * email di conferma non arrivano ai tester.
 */

const db = getDb();
let operator: TestUser;
let shop: TestShop;

async function newUnverifiedUser(name: string) {
  const user = await createTestUser(db, { name });
  await withSystemContext(db, { reason: 'test: email non confermata' }, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { emailVerified: false } }),
  );
  return user;
}

async function userRow(id: string) {
  return withSystemContext(db, { reason: 'test: utente' }, (tx) =>
    tx.user.findUniqueOrThrow({ where: { id }, select: { emailVerified: true } }),
  );
}

async function auditOf(entityId: string) {
  return withSystemContext(db, { reason: 'test: audit' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, select: { action: true, tenantId: true } }),
  );
}

beforeAll(async () => {
  operator = await createTestUser(db, { name: 'Operadora Plataforma' });
  await withSystemContext(db, { reason: 'test: amministratore' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  shop = await createTestShop('Florería Gardelias Prueba');
});

afterAll(async () => {
  await disconnectDb();
});

describe('accesso confermato a mano dalla piattaforma', () => {
  it('conferma l’email (anche scritta con le maiuscole); la seconda volta non cambia nulla', async () => {
    const person = await newUnverifiedUser('Mariana Prueba');
    const first = await confirmUserAccess({
      operatorEmail: operator.email,
      email: `  ${person.email.toUpperCase()} `,
    });
    expect(first).toEqual({ userId: person.id, emailConfirmed: true, membership: null });
    expect((await userRow(person.id)).emailVerified).toBe(true);
    expect(await auditOf(person.id)).toEqual([
      { action: AUDIT_ACTIONS.platformUserEmailConfirmed, tenantId: null },
    ]);

    const again = await confirmUserAccess({ operatorEmail: operator.email, email: person.email });
    expect(again.emailConfirmed).toBe(false);
    expect(await auditOf(person.id)).toHaveLength(1);
  });

  it('la aggiunge a una fioreria come manager: entra con quel ruolo, una volta sola', async () => {
    const person = await newUnverifiedUser('Manager Prueba');
    const result = await confirmUserAccess({
      operatorEmail: operator.email,
      email: person.email,
      tenantSlug: shop.tenant.slug.toUpperCase(),
      role: 'manager',
    });
    expect(result.membership).toEqual({
      tenantSlug: shop.tenant.slug,
      role: 'MANAGER',
      added: true,
    });
    const ctx = await resolveTenantContext({ userId: person.id, slug: shop.tenant.slug });
    expect(ctx?.role).toBe('MANAGER');

    const again = await confirmUserAccess({
      operatorEmail: operator.email,
      email: person.email,
      tenantSlug: shop.tenant.slug,
      role: 'STAFF',
    });
    // Già nel team: il ruolo non cambia da qui.
    expect(again.membership).toEqual({
      tenantSlug: shop.tenant.slug,
      role: 'MANAGER',
      added: false,
    });
    const memberships = await withSystemContext(db, { reason: 'test: membership' }, (tx) =>
      tx.membership.findMany({ where: { userId: person.id }, select: { role: true } }),
    );
    expect(memberships).toEqual([{ role: 'MANAGER' }]);
  });

  it('il proprietario esistente resta proprietario', async () => {
    const result = await confirmUserAccess({
      operatorEmail: operator.email,
      email: shop.tenant.owner.email,
      tenantSlug: shop.tenant.slug,
      role: 'STAFF',
    });
    expect(result.membership).toMatchObject({ role: 'OWNER', added: false });
  });

  it('rifiuta chi non è amministratore, persone e fiorerie inesistenti, ruoli non ammessi', async () => {
    const person = await newUnverifiedUser('Persona Rechazos');
    await expect(
      confirmUserAccess({ operatorEmail: shop.tenant.owner.email, email: person.email }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmUserAccess({ operatorEmail: operator.email, email: 'nadie@e2e.floral.local' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      confirmUserAccess({
        operatorEmail: operator.email,
        email: person.email,
        tenantSlug: 'no-existe-esta-floreria',
        role: 'MANAGER',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const role of ['OWNER', '', null]) {
      await expect(
        confirmUserAccess({
          operatorEmail: operator.email,
          email: person.email,
          tenantSlug: shop.tenant.slug,
          role,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    // Nessun rifiuto ha cambiato qualcosa.
    expect((await userRow(person.id)).emailVerified).toBe(false);
    expect(await auditOf(person.id)).toEqual([]);
  });
});

describe('verifica in due passaggi tolta dalla piattaforma (supporto, ADR-077)', () => {
  it('toglie la verifica, chiude tutte le sessioni e lo registra; solo un amministratore', async () => {
    const person = await createTestUser(db, { name: 'Paula Sin Teléfono' });
    await db.user.update({ where: { id: person.id }, data: { twoFactorEnabled: true } });
    await db.twoFactor.create({
      data: { userId: person.id, secret: 'cifrato', backupCodes: 'cifrati', verified: true },
    });
    for (const token of ['a', 'b']) {
      await db.session.create({
        data: {
          userId: person.id,
          token: `reset-${person.id}-${token}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }

    await expect(
      resetUserTwoFactor({ operatorEmail: person.email, email: person.email }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      resetUserTwoFactor({ operatorEmail: operator.email, email: 'nadie@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const result = await resetUserTwoFactor({
      operatorEmail: operator.email,
      email: person.email.toUpperCase(),
    });
    expect(result).toEqual({ userId: person.id, wasEnabled: true, sessionsClosed: 2 });
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).twoFactorEnabled).toBe(
      false,
    );
    expect(await db.twoFactor.count({ where: { userId: person.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: person.id } })).toBe(0);
    const event = await withSystemContext(db, { reason: 'test: evento' }, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId: null,
          entityId: person.id,
          action: AUDIT_ACTIONS.platformTwoFactorReset,
        },
      }),
    );
    expect(event).toMatchObject({
      actorUserId: operator.id,
      metadata: { via: 'platform-cli', wasEnabled: true, sessions: 2 },
    });

    // Una seconda volta non c'è più nulla da togliere.
    expect(
      await resetUserTwoFactor({ operatorEmail: operator.email, email: person.email }),
    ).toEqual({ userId: person.id, wasEnabled: false, sessionsClosed: 0 });
  });
});
