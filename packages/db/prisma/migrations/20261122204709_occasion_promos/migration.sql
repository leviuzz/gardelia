-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "PromoEmailStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "occasionPromoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "occasionPromoKind" "DiscountKind" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "occasionPromoValue" INTEGER;

-- CreateTable
CREATE TABLE "OccasionPromoEmail" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "occasionId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "status" "PromoEmailStatus" NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "discountKind" "DiscountKind" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccasionPromoEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OccasionPromoEmail_tenantId_occurrenceDate_idx" ON "OccasionPromoEmail"("tenantId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "OccasionPromoEmail_tenantId_customerId_idx" ON "OccasionPromoEmail"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OccasionPromoEmail_tenantId_id_key" ON "OccasionPromoEmail"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OccasionPromoEmail_tenantId_occasionId_occurrenceDate_key" ON "OccasionPromoEmail"("tenantId", "occasionId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "OccasionPromoEmail" ADD CONSTRAINT "OccasionPromoEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccasionPromoEmail" ADD CONSTRAINT "OccasionPromoEmail_tenantId_occasionId_fkey" FOREIGN KEY ("tenantId", "occasionId") REFERENCES "CustomerOccasion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccasionPromoEmail" ADD CONSTRAINT "OccasionPromoEmail_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Promo delle date speciali (ADR-047): vincoli, isolamento e fiorerie da servire.
-- ---------------------------------------------------------------------------

-- Sconto: percentuale intera 1–90 o importo positivo; attivarla richiede lo sconto.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_occasionPromo_check" CHECK (
    ("occasionPromoValue" IS NULL OR "occasionPromoValue" > 0)
    AND ("occasionPromoKind" <> 'PERCENT' OR "occasionPromoValue" IS NULL OR "occasionPromoValue" <= 90)
    AND (NOT "occasionPromoEnabled" OR "occasionPromoValue" IS NOT NULL)
  );

ALTER TABLE "OccasionPromoEmail"
  ADD CONSTRAINT "OccasionPromoEmail_values_check" CHECK (
    "attempts" BETWEEN 1 AND 3
    AND "discountValue" > 0
    AND ("discountKind" <> 'PERCENT' OR "discountValue" <= 90)
    AND "currency" ~ '^[A-Z]{3}$'
    AND ("lastError" IS NULL OR char_length("lastError") <= 60)
    AND ("status" <> 'SENT' OR "sentAt" IS NOT NULL)
  );

SELECT app_enable_tenant_rls('"OccasionPromoEmail"');

-- Fiorerie per cui il lavoro giornaliero manda le email: reali (mai DEMO, ADR-016), attive e con la
-- promo accesa. SECURITY DEFINER come app_expire_overdue: il lavoro riguarda tutte le fiorerie, poi
-- legge e scrive i dati di ognuna nel suo contesto (RLS attiva).
CREATE FUNCTION app_occasion_promo_tenants()
RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t.id FROM "Tenant" AS t
    WHERE t.status = 'ACTIVE'
      AND t.mode = 'LIVE'
      AND t."occasionPromoEnabled"
      AND t."occasionPromoValue" IS NOT NULL
    ORDER BY t.id;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
