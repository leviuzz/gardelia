-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('BASIC', 'PLUS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PILOT', 'TRIALING', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "SaasPlan" (
    "id" UUID NOT NULL,
    "code" "PlanCode" NOT NULL,
    "entitlements" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "source" "SubscriptionSource" NOT NULL DEFAULT 'MANUAL',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaasPlan_code_key" ON "SaasPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSubscription_planId_idx" ON "TenantSubscription"("planId");

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SaasPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Piani iniziali (dati di piattaforma). Nessun prezzo: D-16 è PROPOSTO.
-- La quota di anteprime AI resta 0 finché la pipeline AI non esiste (S1-12, O-05).
-- Inseriti PRIMA di attivare la RLS (la migrazione non usa il contesto di sistema).
-- -----------------------------------------------------------------------------

INSERT INTO "SaasPlan" ("id", "code", "entitlements", "updatedAt") VALUES
  (gen_random_uuid(), 'BASIC', '{"bouquetBuilder": false, "aiPreviewsPerMonth": 0}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PLUS', '{"bouquetBuilder": true, "aiPreviewsPerMonth": 0}', CURRENT_TIMESTAMP);

-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

ALTER TABLE "SaasPlan"
  ADD CONSTRAINT "SaasPlan_entitlements_object_check" CHECK (jsonb_typeof("entitlements") = 'object');

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_period_check"
    CHECK ("currentPeriodEnd" IS NULL OR "currentPeriodEnd" > "currentPeriodStart");

-- -----------------------------------------------------------------------------
-- Row-Level Security
--   SaasPlan: catalogo globale dei piani, leggibile da tutti, scrivibile solo in bypass.
--   TenantSubscription: il tenant legge SOLO il proprio abbonamento e non può
--   modificarlo; le scritture avvengono solo in contesto di sistema (piattaforma).
-- -----------------------------------------------------------------------------

ALTER TABLE "SaasPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaasPlan" FORCE ROW LEVEL SECURITY;

CREATE POLICY saas_plan_read ON "SaasPlan" FOR SELECT USING (true);
CREATE POLICY saas_plan_insert ON "SaasPlan" FOR INSERT WITH CHECK (app_rls_bypass());
CREATE POLICY saas_plan_update ON "SaasPlan" FOR UPDATE
  USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
CREATE POLICY saas_plan_delete ON "SaasPlan" FOR DELETE USING (app_rls_bypass());

ALTER TABLE "TenantSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSubscription" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_subscription_read ON "TenantSubscription" FOR SELECT
  USING ("tenantId" = app_current_tenant_id() OR app_rls_bypass());
CREATE POLICY tenant_subscription_insert ON "TenantSubscription" FOR INSERT
  WITH CHECK (app_rls_bypass());
CREATE POLICY tenant_subscription_update ON "TenantSubscription" FOR UPDATE
  USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
CREATE POLICY tenant_subscription_delete ON "TenantSubscription" FOR DELETE
  USING (app_rls_bypass());
