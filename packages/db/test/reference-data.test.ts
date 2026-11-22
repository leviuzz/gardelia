/**
 * Dati di riferimento (tassonomia dei fiori): arrivano con il rilascio, non con il seed demo, e
 * l'allineamento è idempotente. Il global setup dei test li allinea come farebbe un deploy.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '../src/index';
import { CANONICAL_FLOWERS, syncReferenceData } from '../src/reference-data';

const db = getDb();

afterAll(async () => {
  await disconnectDb();
});

async function flowers() {
  return withSystemContext(db, { reason: 'test: dati di riferimento' }, (tx) =>
    tx.canonicalFlower.findMany({ select: { slug: true, names: true } }),
  );
}

describe('dati di riferimento della piattaforma', () => {
  it('la tassonomia completa c’è anche senza il seed demo', async () => {
    const rows = await flowers();
    const slugs = new Set(rows.map((row) => row.slug));
    for (const flower of CANONICAL_FLOWERS) expect(slugs.has(flower.slug)).toBe(true);
    expect(rows.find((row) => row.slug === 'rosa')?.names).toMatchObject({ 'es-MX': 'Rosa' });
  });

  it('allineare di nuovo non duplica e riporta i valori a quelli del codice', async () => {
    await withSystemContext(db, { reason: 'test: valore cambiato a mano' }, (tx) =>
      tx.canonicalFlower.update({
        where: { slug: 'rosa' },
        data: { names: { 'es-MX': 'Rosita', 'it-IT': 'Rosa', 'en-US': 'Rose' } },
      }),
    );
    const before = (await flowers()).length;
    await syncReferenceData(db);
    await syncReferenceData(db);
    const after = await flowers();
    expect(after).toHaveLength(before);
    expect(after.find((row) => row.slug === 'rosa')?.names).toMatchObject({ 'es-MX': 'Rosa' });
  });
});
