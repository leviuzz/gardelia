-- =============================================================================
-- Invarianti garantiti dal database tramite indici univoci parziali
-- (non esprimibili nello schema Prisma; Prisma Migrate li ignora nel diff).
-- =============================================================================

-- Al massimo una sede primaria per tenant.
CREATE UNIQUE INDEX "Location_one_primary_per_tenant"
  ON "Location" ("tenantId")
  WHERE "isPrimary";

-- Al massimo un invito IN ATTESA per (tenant, email): un nuovo invito sostituisce il precedente.
CREATE UNIQUE INDEX "Invitation_one_pending_per_email"
  ON "Invitation" ("tenantId", "email")
  WHERE "status" = 'PENDING';
