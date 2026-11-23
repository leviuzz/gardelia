/**
 * Supporto al registro di audit: calcolo delle differenze fra stato precedente e successivo
 * (spec §4.2: "le modifiche critiche registrano autore, timestamp e diff").
 */

export interface FieldChange {
  readonly from: unknown;
  readonly to: unknown;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Restituisce solo i campi effettivamente cambiati, fra quelli elencati. */
export function diffFields<T extends object>(
  before: T,
  after: Partial<T>,
  keys: readonly (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (!isEqual(from, to)) changes[key] = { from: normalize(from), to: normalize(to) };
  }
  return changes;
}

/** Azioni registrate nell'audit log (stringhe stabili: usate anche dalla UI "attività recente"). */
export const AUDIT_ACTIONS = {
  tenantCreated: 'tenant.created',
  tenantUpdated: 'tenant.updated',
  tenantPromoUpdated: 'tenant.promo_updated',
  locationUpdated: 'location.updated',
  memberInvited: 'member.invited',
  invitationRevoked: 'invitation.revoked',
  invitationAccepted: 'invitation.accepted',
  memberRoleChanged: 'member.role_changed',
  memberDeactivated: 'member.deactivated',
  memberReactivated: 'member.reactivated',
  catalogItemCreated: 'catalog_item.created',
  catalogItemUpdated: 'catalog_item.updated',
  catalogItemArchived: 'catalog_item.archived',
  catalogItemRestored: 'catalog_item.restored',
  catalogPhotoAdded: 'catalog_item.photo_added',
  catalogPhotoArchived: 'catalog_item.photo_archived',
  recipeUpdated: 'recipe.updated',
  recipeLineAdded: 'recipe.line_added',
  recipeLineUpdated: 'recipe.line_updated',
  recipeLineRemoved: 'recipe.line_removed',
  customerCreated: 'customer.created',
  customerUpdated: 'customer.updated',
  customerArchived: 'customer.archived',
  customerRestored: 'customer.restored',
  customerAddressAdded: 'customer.address_added',
  customerAddressUpdated: 'customer.address_updated',
  customerAddressArchived: 'customer.address_archived',
  customerOccasionAdded: 'customer.occasion_added',
  customerOccasionRemoved: 'customer.occasion_removed',
  /** Il cliente ha tolto il consenso alle promozioni dal link dell'email. */
  customerUnsubscribed: 'customer.unsubscribed',
  /** Sconto della promo segnato come usato, o tolto il segno (ADR-048). */
  promoRedeemed: 'promo.redeemed',
  promoRedemptionUndone: 'promo.redemption_undone',
  quoteCreated: 'quote.created',
  quoteUpdated: 'quote.updated',
  quoteLineAdded: 'quote.line_added',
  quoteLineUpdated: 'quote.line_updated',
  quoteLineRemoved: 'quote.line_removed',
  quoteStatusChanged: 'quote.status_changed',
  subscriptionAssigned: 'subscription.assigned',
  builderConfigurationCreated: 'builder.configuration_created',
  builderConfigurationUpdated: 'builder.configuration_updated',
  builderConfigurationArchived: 'builder.configuration_archived',
  builderConfigurationRestored: 'builder.configuration_restored',
  builderConfigurationDeleted: 'builder.configuration_deleted',
  /** Foto vera del ramo caricata o tolta da un disegno (ADR-052). */
  builderPhotoAdded: 'builder.photo_added',
  builderPhotoRemoved: 'builder.photo_removed',
  aiPreviewRequested: 'ai.preview_requested',
  styleReferenceAdded: 'builder.style_reference_added',
  styleReferenceArchived: 'builder.style_reference_archived',
  aiCreditsGranted: 'ai_credits.granted',
  securityTenantAccessDenied: 'security.tenant_access_denied',
  securityCrossTenantAccess: 'security.cross_tenant_access_attempt',
  platformAdminBootstrapped: 'platform.admin_bootstrapped',
  /** Email confermata a mano dall'amministratore (senza email di conferma, ADR-050). */
  platformUserEmailConfirmed: 'platform.user_email_confirmed',
  /** Persona aggiunta al team dall'amministratore della piattaforma (ADR-050). */
  memberAddedByPlatform: 'member.added_by_platform',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
