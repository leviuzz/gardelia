-- CreateEnum
CREATE TYPE "QuoteTaxMode" AS ENUM ('PRICES_FINAL');

-- CreateEnum
CREATE TYPE "QuoteLineKind" AS ENUM ('CATALOG_ITEM', 'CUSTOM');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "taxMode" "QuoteTaxMode" NOT NULL DEFAULT 'PRICES_FINAL',
ADD COLUMN     "title" TEXT,
ALTER COLUMN "validUntil" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "kind" "QuoteLineKind" NOT NULL DEFAULT 'CATALOG_ITEM';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "TenantCounter" (
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCounter_pkey" PRIMARY KEY ("tenantId","key")
);

-- AddForeignKey
ALTER TABLE "TenantCounter" ADD CONSTRAINT "TenantCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità
-- =============================================================================

SELECT app_enable_tenant_rls('"TenantCounter"');

ALTER TABLE "TenantCounter"
  ADD CONSTRAINT "TenantCounter_value_check" CHECK ("value" > 0);

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_quoteValidityDays_check" CHECK ("quoteValidityDays" BETWEEN 1 AND 90);

-- Coerenza monetaria garantita dal database (anche in caso di bug applicativi).
ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_discount_le_subtotal_check" CHECK ("discountMinor" <= "subtotalMinor"),
  ADD CONSTRAINT "Quote_total_consistency_check"
    CHECK ("totalMinor" = "subtotalMinor" - "discountMinor" + "taxMinor");

ALTER TABLE "QuoteLine"
  ADD CONSTRAINT "QuoteLine_total_consistency_check"
    CHECK ("lineTotalMinor" = "quantity" * "unitPriceMinor"),
  ADD CONSTRAINT "QuoteLine_kind_item_check"
    CHECK (("kind" = 'CATALOG_ITEM') = ("catalogItemId" IS NOT NULL));
