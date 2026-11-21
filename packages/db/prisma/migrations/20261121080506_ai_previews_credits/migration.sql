-- CreateEnum
CREATE TYPE "AiQuotaSource" AS ENUM ('INCLUDED', 'EXTRA');

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "bouquetConfigurationId" UUID,
ADD COLUMN     "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "outputContentType" TEXT,
ADD COLUMN     "outputKey" TEXT,
ADD COLUMN     "quotaSource" "AiQuotaSource",
ADD COLUMN     "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AiCreditGrant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "units" INTEGER NOT NULL,
    "note" TEXT,
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCreditGrant_tenantId_feature_createdAt_idx" ON "AiCreditGrant"("tenantId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_status_runAfter_idx" ON "AiJob"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_tenantId_bouquetConfigurationId_fkey" FOREIGN KEY ("tenantId", "bouquetConfigurationId") REFERENCES "BouquetConfiguration"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCreditGrant" ADD CONSTRAINT "AiCreditGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

ALTER TABLE "AiCreditGrant"
  ADD CONSTRAINT "AiCreditGrant_units_check" CHECK ("units" BETWEEN 1 AND 10000);

ALTER TABLE "AiJob"
  ADD CONSTRAINT "AiJob_estimatedCostMicros_check" CHECK ("estimatedCostMicros" >= 0);

-- -----------------------------------------------------------------------------
-- RLS: i crediti extra si leggono solo nel proprio tenant e si scrivono solo dalla
-- piattaforma (contesto di sistema), come gli abbonamenti (ADR-024).
-- -----------------------------------------------------------------------------

ALTER TABLE "AiCreditGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCreditGrant" FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_credit_grant_read ON "AiCreditGrant" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY ai_credit_grant_insert ON "AiCreditGrant" FOR INSERT
  WITH CHECK (app_rls_bypass());
CREATE POLICY ai_credit_grant_update ON "AiCreditGrant" FOR UPDATE
  USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
CREATE POLICY ai_credit_grant_delete ON "AiCreditGrant" FOR DELETE
  USING (app_rls_bypass());

-- -----------------------------------------------------------------------------
-- Coda dei job AI (ADR-025). Funzioni SECURITY DEFINER: il worker preleva il prossimo
-- job di QUALSIASI tenant senza usare il bypass RLS nel codice applicativo; poi lavora
-- il job nel contesto del suo tenant. Le date sono UTC (convenzione di Prisma).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_claim_ai_job(lease_seconds integer)
RETURNS TABLE (job_id uuid, tenant_id uuid, requested_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  utc_now timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Lease scaduto e tentativi esauriti: il job fallisce (non consuma crediti).
  UPDATE "AiJob"
  SET status = 'FAILED', "errorCode" = 'lease_expired', "finishedAt" = utc_now,
      "lockedUntil" = NULL, "usageUnits" = 0, "updatedAt" = utc_now
  WHERE status = 'RUNNING' AND "lockedUntil" < utc_now AND attempts >= "maxAttempts";

  RETURN QUERY
    UPDATE "AiJob" AS j
    SET status = 'RUNNING',
        attempts = j.attempts + 1,
        "startedAt" = utc_now,
        "lockedUntil" = utc_now + make_interval(secs => lease_seconds),
        "updatedAt" = utc_now
    WHERE j.id = (
      SELECT c.id
      FROM "AiJob" AS c
      WHERE c.attempts < c."maxAttempts"
        AND (
          (c.status = 'QUEUED' AND c."runAfter" <= utc_now)
          OR (c.status = 'RUNNING' AND c."lockedUntil" < utc_now)
        )
      ORDER BY c."runAfter", c."createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j."tenantId", j."requestedById";

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN;
END
$$;

-- Spesa stimata/effettiva di tutta la piattaforma da un istante: solo il totale, nessun
-- dato dei tenant (tetto di spesa mensile, ADR-024).
CREATE OR REPLACE FUNCTION app_ai_spend_since(since timestamptz)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  total bigint;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  SELECT coalesce(sum(
    CASE
      WHEN status IN ('QUEUED', 'RUNNING') THEN "estimatedCostMicros"
      WHEN status = 'SUCCEEDED' THEN coalesce("providerCostMicros", "estimatedCostMicros")
      ELSE coalesce("providerCostMicros", 0)
    END), 0)
  INTO total
  FROM "AiJob"
  WHERE "createdAt" >= (since AT TIME ZONE 'UTC');
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN total;
END
$$;

-- -----------------------------------------------------------------------------
-- Dati: 25 anteprime al mese incluse nel Plus (ADR-024). Visibili solo quando le
-- anteprime sono attive (provider configurato).
-- -----------------------------------------------------------------------------

SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "SaasPlan"
  SET "entitlements" = jsonb_set("entitlements", '{aiPreviewsPerMonth}', '25'::jsonb),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "code" = 'PLUS';
SELECT set_config('app.bypass_rls', '', false);
