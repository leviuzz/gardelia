-- Impostazioni di consegna (ADR-055, blocco A2): fasce orarie proposte negli ordini, giorni di
-- chiusura e costo di consegna predefinito.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "defaultDeliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryClosedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "DeliveryWindow" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryWindow_tenantId_idx" ON "DeliveryWindow"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryWindow_tenantId_id_key" ON "DeliveryWindow"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryWindow_tenantId_startMinutes_endMinutes_key" ON "DeliveryWindow"("tenantId", "startMinutes", "endMinutes");

-- AddForeignKey
ALTER TABLE "DeliveryWindow" ADD CONSTRAINT "DeliveryWindow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Sicurezza e integrità (ADR-055)
-- =============================================================================

SELECT app_enable_tenant_rls('"DeliveryWindow"');

-- Una fascia sta dentro la giornata ed è in ordine (come la fascia di un ordine).
ALTER TABLE "DeliveryWindow"
  ADD CONSTRAINT "DeliveryWindow_range_check"
    CHECK ("startMinutes" >= 0 AND "endMinutes" <= 1440 AND "startMinutes" < "endMinutes");

-- Costo mai negativo; giorni sempre presenti e solo da 0 (domenica) a 6 (sabato).
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_default_delivery_fee_check" CHECK ("defaultDeliveryFeeMinor" >= 0),
  ADD CONSTRAINT "Tenant_closed_weekdays_check" CHECK (
    "deliveryClosedWeekdays" IS NOT NULL
    AND "deliveryClosedWeekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
  );
