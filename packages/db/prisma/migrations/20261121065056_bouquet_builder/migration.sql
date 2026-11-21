-- CreateEnum
CREATE TYPE "BouquetStyle" AS ENUM ('ROMANTIC', 'CLASSIC', 'MODERN', 'GARDEN', 'MINIMAL', 'TROPICAL');

-- CreateEnum
CREATE TYPE "BouquetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE');

-- CreateEnum
CREATE TYPE "BuilderRole" AS ENUM ('FLOWER', 'FOLIAGE', 'PACKAGING', 'ACCESSORY');

-- AlterEnum
ALTER TYPE "QuoteLineKind" ADD VALUE 'BUILDER';

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "isBuilderEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "bouquetConfigurationId" UUID;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "builderLaborFeeMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BouquetConfiguration" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "style" "BouquetStyle",
    "size" "BouquetSize",
    "budgetMinor" INTEGER,
    "notes" TEXT,
    "currency" CHAR(3) NOT NULL,
    "componentsMinor" INTEGER NOT NULL,
    "laborMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "estimatedCostMinor" INTEGER,
    "pricingVersion" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BouquetConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BouquetConfigurationLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "configurationId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "role" "BuilderRole" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "unitCostMinor" INTEGER,
    "lineTotalMinor" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BouquetConfigurationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BouquetConfiguration_tenantId_status_updatedAt_idx" ON "BouquetConfiguration"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BouquetConfiguration_tenantId_id_key" ON "BouquetConfiguration"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BouquetConfigurationLine_tenantId_catalogItemId_idx" ON "BouquetConfigurationLine"("tenantId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BouquetConfigurationLine_tenantId_id_key" ON "BouquetConfigurationLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BouquetConfigurationLine_tenantId_configurationId_catalogIt_key" ON "BouquetConfigurationLine"("tenantId", "configurationId", "catalogItemId");

-- CreateIndex
CREATE INDEX "QuoteLine_tenantId_bouquetConfigurationId_idx" ON "QuoteLine"("tenantId", "bouquetConfigurationId");

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_tenantId_bouquetConfigurationId_fkey" FOREIGN KEY ("tenantId", "bouquetConfigurationId") REFERENCES "BouquetConfiguration"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetConfiguration" ADD CONSTRAINT "BouquetConfiguration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetConfigurationLine" ADD CONSTRAINT "BouquetConfigurationLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetConfigurationLine" ADD CONSTRAINT "BouquetConfigurationLine_tenantId_configurationId_fkey" FOREIGN KEY ("tenantId", "configurationId") REFERENCES "BouquetConfiguration"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BouquetConfigurationLine" ADD CONSTRAINT "BouquetConfigurationLine_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Row-Level Security (tabelle del tenant)
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"BouquetConfiguration"');
SELECT app_enable_tenant_rls('"BouquetConfigurationLine"');

-- -----------------------------------------------------------------------------
-- Vincoli di coerenza (il prezzo lo calcola il server; il DB ne garantisce l'aritmetica)
-- -----------------------------------------------------------------------------

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_builderLaborFeeMinor_check" CHECK ("builderLaborFeeMinor" >= 0);

ALTER TABLE "BouquetConfiguration"
  ADD CONSTRAINT "BouquetConfiguration_amounts_check" CHECK (
    "componentsMinor" >= 0 AND "laborMinor" >= 0
    AND ("budgetMinor" IS NULL OR "budgetMinor" >= 0)
    AND ("estimatedCostMinor" IS NULL OR "estimatedCostMinor" >= 0)
  ),
  ADD CONSTRAINT "BouquetConfiguration_total_check"
    CHECK ("totalMinor" = "componentsMinor" + "laborMinor"),
  ADD CONSTRAINT "BouquetConfiguration_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "BouquetConfigurationLine"
  ADD CONSTRAINT "BouquetConfigurationLine_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "BouquetConfigurationLine_amounts_check" CHECK (
    "unitPriceMinor" >= 0 AND ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0)
  ),
  ADD CONSTRAINT "BouquetConfigurationLine_total_check"
    CHECK ("lineTotalMinor" = "quantity" * "unitPriceMinor");

-- -----------------------------------------------------------------------------
-- Dati: i componenti già a catalogo diventano utilizzabili nel Builder (stesso default
-- dei nuovi articoli; il fiorista può disattivarli). La tabella ha FORCE RLS: la
-- migrazione attiva il bypass solo per questo aggiornamento.
-- -----------------------------------------------------------------------------

SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CatalogItem"
  SET "isBuilderEnabled" = true
  WHERE "type" IN ('CUT_FLOWER', 'FOLIAGE', 'PACKAGING', 'CONTAINER', 'ACCESSORY');
SELECT set_config('app.bypass_rls', '', false);
