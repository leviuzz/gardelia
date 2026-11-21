import { describe, expect, it } from 'vitest';
import { PERMISSIONS, can, invitableRoles, isMembershipRole } from '../src/permissions';

describe('matrice dei permessi', () => {
  it('il proprietario può tutto', () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can('OWNER', permission)).toBe(true);
    }
  });

  it('il manager gestisce l’operatività ma non dati legali, billing e ruoli', () => {
    expect(can('MANAGER', 'catalog:write')).toBe(true);
    expect(can('MANAGER', 'catalog:costs:read')).toBe(true);
    expect(can('MANAGER', 'tenant:settings:update')).toBe(true);
    expect(can('MANAGER', 'members:invite')).toBe(true);
    expect(can('MANAGER', 'tenant:legal:update')).toBe(false);
    expect(can('MANAGER', 'billing:manage')).toBe(false);
    expect(can('MANAGER', 'members:manage')).toBe(false);
  });

  it('lo staff legge il catalogo ma non modifica, non vede costi né team', () => {
    expect(can('STAFF', 'catalog:read')).toBe(true);
    expect(can('STAFF', 'catalog:write')).toBe(false);
    expect(can('STAFF', 'catalog:costs:read')).toBe(false);
    expect(can('STAFF', 'members:read')).toBe(false);
    expect(can('STAFF', 'audit:read')).toBe(false);
  });

  it('limita i ruoli assegnabili via invito', () => {
    expect(invitableRoles('OWNER')).toEqual(['OWNER', 'MANAGER', 'STAFF']);
    expect(invitableRoles('MANAGER')).toEqual(['STAFF']);
    expect(invitableRoles('STAFF')).toEqual([]);
  });

  it('riconosce solo ruoli validi', () => {
    expect(isMembershipRole('OWNER')).toBe(true);
    expect(isMembershipRole('owner')).toBe(false);
    expect(isMembershipRole('SUPER_ADMIN')).toBe(false);
  });
});
