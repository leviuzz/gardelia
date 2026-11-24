import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ConflictError,
  NotFoundError,
  getTwoFactorRequirement,
  listAccountSessions,
  recordAccountSecurityEvent,
  revokeAccountSession,
  revokeOtherAccountSessions,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Sicurezza del conto (ADR-077): obbligo della verifica in due passaggi per i titolari con
 * password (14 giorni), sessioni della persona e solo sue, eventi senza dati sensibili.
 */

const db = getDb();
const day = 24 * 60 * 60 * 1000;
let shop: TestShop;

async function givePassword(userId: string): Promise<void> {
  await db.account.create({
    data: { userId, accountId: userId, providerId: 'credential', password: 'hash-di-prova' },
  });
}

async function openSession(userId: string, userAgent: string): Promise<string> {
  const session = await db.session.create({
    data: {
      userId,
      token: `token-${userId}-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 7 * day),
      userAgent,
    },
  });
  return session.id;
}

beforeAll(async () => {
  shop = await createTestShop('Florería Segura');
  // Le fiorerie di prova nascono demo: questa è una fioreria vera.
  await withSystemContext(db, { reason: 'test: fioreria vera' }, (tx) =>
    tx.tenant.update({ where: { id: shop.owner.tenantId }, data: { mode: 'LIVE' } }),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('verifica in due passaggi obbligatoria', () => {
  it('titolare con password: 14 giorni, poi blocca; attiva, non blocca più', async () => {
    const userId = shop.owner.userId;
    expect((await getTwoFactorRequirement(userId)).required).toBe(false);

    await givePassword(userId);
    const now = new Date();
    const soon = await getTwoFactorRequirement(userId, now);
    expect(soon).toMatchObject({ required: true, enabled: false, blocking: false });
    expect(soon.deadline!.getTime()).toBeGreaterThan(now.getTime() + 13 * day);

    const later = await getTwoFactorRequirement(userId, new Date(now.getTime() + 15 * day));
    expect(later.blocking).toBe(true);

    await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    const enabled = await getTwoFactorRequirement(userId, new Date(now.getTime() + 15 * day));
    expect(enabled).toMatchObject({ enabled: true, blocking: false, deadline: null });
  });

  it('manager e staff con password non sono obbligati; nemmeno il titolare di una demo', async () => {
    await givePassword(shop.manager.userId);
    const later = new Date(Date.now() + 30 * day);
    expect((await getTwoFactorRequirement(shop.manager.userId, later)).required).toBe(false);

    const demo = await createTestShop('Florería Demo Segura');
    await withSystemContext(db, { reason: 'test: fioreria demo' }, (tx) =>
      tx.tenant.update({ where: { id: demo.owner.tenantId }, data: { mode: 'DEMO' } }),
    );
    await givePassword(demo.owner.userId);
    expect((await getTwoFactorRequirement(demo.owner.userId, later)).required).toBe(false);
  });
});

describe('dispositivi collegati', () => {
  it('ognuno vede e chiude solo le sue sessioni; quella in uso resta', async () => {
    const ana = await createTestUser(db, { name: 'Ana Dispositivos' });
    const beto = await createTestUser(db, { name: 'Beto Dispositivos' });
    const current = await openSession(ana.id, 'Chrome Android');
    const tablet = await openSession(ana.id, 'Safari iPad');
    const laptop = await openSession(ana.id, 'Firefox Windows');
    const betoSession = await openSession(beto.id, 'Chrome Windows');

    const sessions = await listAccountSessions(ana.id, current);
    expect(sessions.map((session) => session.id).sort()).toEqual([current, tablet, laptop].sort());
    expect(sessions.find((session) => session.current)?.id).toBe(current);

    await expect(
      revokeAccountSession({ userId: ana.id, currentSessionId: current, sessionId: current }),
    ).rejects.toBeInstanceOf(ConflictError);
    // La sessione di un'altra persona per Ana non esiste.
    await expect(
      revokeAccountSession({ userId: ana.id, currentSessionId: current, sessionId: betoSession }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      revokeAccountSession({ userId: ana.id, currentSessionId: current, sessionId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await revokeAccountSession({ userId: ana.id, currentSessionId: current, sessionId: tablet });
    expect((await listAccountSessions(ana.id, current)).map((session) => session.id)).not.toContain(
      tablet,
    );

    expect(await revokeOtherAccountSessions({ userId: ana.id, currentSessionId: current })).toBe(1);
    expect((await listAccountSessions(ana.id, current)).map((session) => session.id)).toEqual([
      current,
    ]);
    // Beto non perde nulla.
    expect((await listAccountSessions(beto.id, betoSession)).map((s) => s.id)).toEqual([
      betoSession,
    ]);

    const events = await withSystemContext(db, { reason: 'test: eventi' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, actorUserId: ana.id },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    );
    expect(events.map((event) => event.action)).toEqual([
      'security.session_revoked',
      'security.other_sessions_revoked',
    ]);
    expect(events[1]?.metadata).toEqual({ sessions: 1 });
  });

  it('gli eventi della verifica si registrano con il solo ID', async () => {
    const user = await createTestUser(db, { name: 'Carla Eventos' });
    await recordAccountSecurityEvent(user.id, 'security.two_factor_enabled');
    const event = await withSystemContext(db, { reason: 'test: evento' }, (tx) =>
      tx.auditLog.findFirst({ where: { tenantId: null, actorUserId: user.id } }),
    );
    expect(event).toMatchObject({
      action: 'security.two_factor_enabled',
      entityType: 'User',
      entityId: user.id,
      metadata: null,
    });
  });
});
