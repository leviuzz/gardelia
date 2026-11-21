/**
 * Ruoli merchant e matrice dei permessi (RBAC).
 *
 * È l'UNICA fonte di verità sui permessi: i servizi in @floral/core la applicano lato server
 * su ogni operazione; la UI la usa solo per decidere cosa mostrare.
 * Proposta Sprint 0 (vedi docs/DECISIONS.md, D-T08): lo STAFF non vede costi e margini.
 */

export const MEMBERSHIP_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const ALL = ['OWNER', 'MANAGER', 'STAFF'] as const satisfies readonly MembershipRole[];
const MANAGEMENT = ['OWNER', 'MANAGER'] as const satisfies readonly MembershipRole[];
const OWNER_ONLY = ['OWNER'] as const satisfies readonly MembershipRole[];

export const PERMISSIONS = {
  /** Vedere dashboard e dati base della fioreria. */
  'tenant:read': ALL,
  /** Modificare profilo operativo: nome commerciale, contatti, fuso, sede. */
  'tenant:settings:update': MANAGEMENT,
  /** Modificare dati legali/fiscali (ragione sociale, RFC). */
  'tenant:legal:update': OWNER_ONLY,
  /** Gestire piano SaaS, addon e pagamenti (sprint billing). */
  'billing:manage': OWNER_ONLY,
  /** Vedere membri e inviti del team. */
  'members:read': MANAGEMENT,
  /** Invitare persone (limitato dai ruoli assegnabili, vedi `invitableRoles`). */
  'members:invite': MANAGEMENT,
  /** Cambiare ruoli, disattivare/riattivare membri. */
  'members:manage': OWNER_ONLY,
  'catalog:read': ALL,
  'catalog:write': MANAGEMENT,
  /** Vedere costi, distinta con costi e margini. */
  'catalog:costs:read': MANAGEMENT,
  'customers:read': ALL,
  'customers:write': MANAGEMENT,
  'quotes:read': ALL,
  /** Creare e modificare preventivi, cambiarne lo stato. */
  'quotes:write': MANAGEMENT,
  /** Vedere il registro attività (audit) della fioreria. */
  'audit:read': MANAGEMENT,
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MembershipRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MembershipRole[]).includes(role);
}

/** Ruoli che un membro può assegnare tramite invito. */
export function invitableRoles(role: MembershipRole): readonly MembershipRole[] {
  switch (role) {
    case 'OWNER':
      return ['OWNER', 'MANAGER', 'STAFF'];
    case 'MANAGER':
      return ['STAFF'];
    case 'STAFF':
      return [];
  }
}

export function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}
