-- CreateEnum
CREATE TYPE "OccasionType" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'CUSTOM');

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "deliveryNotes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOccasion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "OccasionType" NOT NULL,
    "label" TEXT,
    "personName" TEXT,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "year" INTEGER,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOccasion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAddress_tenantId_customerId_idx" ON "CustomerAddress"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_tenantId_id_key" ON "CustomerAddress"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerOccasion_tenantId_month_day_idx" ON "CustomerOccasion"("tenantId", "month", "day");

-- CreateIndex
CREATE INDEX "CustomerOccasion_tenantId_customerId_idx" ON "CustomerOccasion"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOccasion_tenantId_id_key" ON "CustomerOccasion"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOccasion" ADD CONSTRAINT "CustomerOccasion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOccasion" ADD CONSTRAINT "CustomerOccasion_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità (non esprimibili in Prisma)
-- =============================================================================

SELECT app_enable_tenant_rls('"CustomerAddress"');
SELECT app_enable_tenant_rls('"CustomerOccasion"');

ALTER TABLE "CustomerAddress"
  ADD CONSTRAINT "CustomerAddress_countryCode_check" CHECK ("countryCode" ~ '^[A-Z]{2}$');

-- Al massimo un indirizzo predefinito attivo per cliente.
CREATE UNIQUE INDEX "CustomerAddress_one_default_per_customer"
  ON "CustomerAddress" ("tenantId", "customerId")
  WHERE "isDefault" AND "status" = 'ACTIVE';

ALTER TABLE "CustomerOccasion"
  ADD CONSTRAINT "CustomerOccasion_month_check" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "CustomerOccasion_day_check" CHECK ("day" BETWEEN 1 AND 31),
  ADD CONSTRAINT "CustomerOccasion_year_check" CHECK ("year" IS NULL OR "year" BETWEEN 1900 AND 2100),
  ADD CONSTRAINT "CustomerOccasion_remind_check" CHECK ("remindDaysBefore" BETWEEN 0 AND 60),
  ADD CONSTRAINT "CustomerOccasion_custom_label_check" CHECK ("type" <> 'CUSTOM' OR "label" IS NOT NULL);
