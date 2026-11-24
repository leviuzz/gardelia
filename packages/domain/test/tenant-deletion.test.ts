import { describe, expect, it } from 'vitest';
import {
  TENANT_DELETION,
  tenantDeleteAfter,
  tenantDeletionBlockers,
  tenantDeletionSchema,
} from '../src/index';

/** "Eliminar florería" (ADR-074): blocchi, 30 giorni, conferma col nome. */
describe('eliminazione della fioreria', () => {
  it('gli ordini in corso bloccano; borradores e ordini chiusi no', () => {
    expect(tenantDeletionBlockers({ orderStatuses: [] })).toEqual([]);
    expect(
      tenantDeletionBlockers({ orderStatuses: ['DRAFT', 'DELIVERED', 'PICKED_UP', 'CANCELLED'] }),
    ).toEqual([]);
    for (const status of [
      'PENDING_ACCEPTANCE',
      'CONFIRMED',
      'IN_PREPARATION',
      'READY',
      'OUT_FOR_DELIVERY',
    ] as const) {
      expect(tenantDeletionBlockers({ orderStatuses: ['DELIVERED', status] })).toEqual([
        'tenant_deletion_open_orders',
      ]);
    }
  });

  it('si cancella davvero 30 giorni dopo la richiesta', () => {
    expect(TENANT_DELETION.graceDays).toBe(30);
    expect(tenantDeleteAfter(new Date('2026-11-24T10:00:00Z')).toISOString()).toBe(
      '2026-12-24T10:00:00.000Z',
    );
  });

  it("il nome si scrive com'è, senza badare a maiuscole, accenti e spazi", () => {
    const schema = tenantDeletionSchema('Florería Las Rosas');
    expect(schema.safeParse({ confirmName: 'floreria  las rosas ' }).success).toBe(true);
    expect(schema.safeParse({ confirmName: 'FLORERÍA LAS ROSAS' }).success).toBe(true);
    const wrong = schema.safeParse({ confirmName: 'Las Rosas' });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe('tenant_deletion_name_mismatch');
    expect(schema.safeParse({ confirmName: '' }).error?.issues[0]?.message).toBe('required');
  });
});
