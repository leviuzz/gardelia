/**
 * Una connessione esegue una query alla volta (`SerialClient`): dentro una transazione Prisma
 * lancia anche query in parallelo, e pg 8 le accettava solo con un avviso ("Calling
 * client.query() when the client is already executing a query"), che in pg 9 diventa un errore.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDbClient, withSystemContext } from '../src/index';
import { serializeQueries } from '../src/serial-client';
import { createTestTenant } from '../src/testing';

const PG_CONCURRENCY_WARNING = /already executing a query/;

describe('una query alla volta per connessione', () => {
  it('le query con promessa partono una dopo l’altra, in ordine; un errore non ferma la coda', async () => {
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const run = vi.fn(async (sql: unknown) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${String(sql)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      log.push(`end ${String(sql)}`);
      if (sql === 'boom') throw new Error('boom');
      return sql;
    });
    const query = serializeQueries(run);
    const results = await Promise.allSettled([query('a'), query('boom'), query('c')]);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start boom', 'end boom', 'start c', 'end c']);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('le forme con callback o con un oggetto Submittable passano invariate', () => {
    const run = vi.fn(() => 'direct');
    const query = serializeQueries(run);
    expect(query('SELECT 1', () => undefined)).toBe('direct');
    expect(query({ submit: () => undefined })).toBe('direct');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('una lettura con più relazioni in una transazione non usa la coda deprecata di pg', async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => {
      if (PG_CONCURRENCY_WARNING.test(warning.message)) warnings.push(warning.message);
    };
    process.on('warning', onWarning);
    const db = createDbClient({ connectionString: process.env.DATABASE_URL ?? '', poolMax: 1 });
    try {
      const tenant = await createTestTenant(db);
      // Prisma carica le tre relazioni con tre query lanciate insieme sulla stessa connessione
      // (prova del 23/11: senza `SerialClient` la terza finiva nella coda deprecata di pg).
      const found = await withSystemContext(db, { reason: 'test: relazioni in parallelo' }, (tx) =>
        tx.tenant.findFirst({
          where: { id: tenant.tenantId },
          include: { memberships: true, catalogItems: true, customers: true },
        }),
      );
      expect(found?.memberships).toHaveLength(1);
    } finally {
      await db.$disconnect();
    }
    // pg emette l'avviso al giro successivo del ciclo degli eventi.
    await new Promise((resolve) => setImmediate(resolve));
    process.off('warning', onWarning);
    expect(warnings).toEqual([]);
  });
});
