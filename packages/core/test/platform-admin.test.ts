import { afterAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { ConflictError, NotFoundError } from '../src/index';
import { bootstrapPlatformAdmin } from '../src/platform';

const db = getDb();

afterAll(async () => {
  await disconnectDb();
});

describe('primo amministratore della piattaforma', () => {
  it('se esiste già un amministratore si rifiuta (si nomina una volta sola)', async () => {
    const existing = await createTestUser(db, { name: 'Admin existente' });
    await withSystemContext(db, { reason: 'test: amministratore esistente' }, (tx) =>
      tx.user.update({ where: { id: existing.id }, data: { platformRole: 'SUPER_ADMIN' } }),
    );
    const candidate = await createTestUser(db, { name: 'Candidato' });
    await expect(bootstrapPlatformAdmin({ email: candidate.email })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const after = await withSystemContext(db, { reason: 'test: verifica ruolo' }, (tx) =>
      tx.user.findUnique({ where: { id: candidate.id }, select: { platformRole: true } }),
    );
    expect(after?.platformRole).toBe('NONE');
  });

  it('rifiuta un indirizzo vuoto', async () => {
    await expect(bootstrapPlatformAdmin({ email: '   ' })).rejects.toMatchObject({
      fieldErrors: { email: 'required' },
    });
  });

  it('non rivela nulla su chi non esiste', async () => {
    // Con un amministratore già presente la risposta è sempre il rifiuto, mai "utente non trovato".
    await expect(
      bootstrapPlatformAdmin({ email: 'nessuno@e2e.floral.local' }),
    ).rejects.not.toBeInstanceOf(NotFoundError);
  });
});
