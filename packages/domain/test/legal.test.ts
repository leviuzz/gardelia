import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION, buyerAccountDeletionBlockers } from '../src/index';

/** Diritti di chi compra (ADR-068): quando può eliminare da sola il suo conto. */
describe('eliminare il conto cliente', () => {
  it('libero senza fiorerie né ordini in corso', () => {
    expect(
      buyerAccountDeletionBlockers({
        memberships: 0,
        platformRole: 'NONE',
        orderStatuses: ['DELIVERED', 'PICKED_UP', 'CANCELLED'],
      }),
    ).toEqual([]);
  });

  it('bloccato da una fioreria, dal ruolo di piattaforma o da un ordine in corso', () => {
    expect(
      buyerAccountDeletionBlockers({
        memberships: 1,
        platformRole: 'SUPER_ADMIN',
        orderStatuses: ['DELIVERED', 'PENDING_ACCEPTANCE'],
      }),
    ).toEqual(['shop_member', 'platform_role', 'orders_in_progress']);
    for (const status of ['CONFIRMED', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY']) {
      expect(
        buyerAccountDeletionBlockers({
          memberships: 0,
          platformRole: 'NONE',
          orderStatuses: [status],
        }),
      ).toEqual(['orders_in_progress']);
    }
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
