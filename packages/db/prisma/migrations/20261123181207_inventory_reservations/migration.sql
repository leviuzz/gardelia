-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'USED', 'RELEASED');

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "expiresOn" DATE NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "usedEntryId" UUID,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservationLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "usedQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryReservationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReservation_tenantId_status_expiresOn_idx" ON "InventoryReservation"("tenantId", "status", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_tenantId_id_key" ON "InventoryReservation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_tenantId_usedEntryId_key" ON "InventoryReservation"("tenantId", "usedEntryId");

-- CreateIndex
CREATE INDEX "InventoryReservationLine_tenantId_inventoryItemId_idx" ON "InventoryReservationLine"("tenantId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationLine_tenantId_id_key" ON "InventoryReservationLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationLine_reservationId_inventoryItemId_key" ON "InventoryReservationLine"("reservationId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_tenantId_usedEntryId_fkey" FOREIGN KEY ("tenantId", "usedEntryId") REFERENCES "InventoryEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_tenantId_reservationId_fkey" FOREIGN KEY ("tenantId", "reservationId") REFERENCES "InventoryReservation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_tenantId_inventoryItemId_fkey" FOREIGN KEY ("tenantId", "inventoryItemId") REFERENCES "InventoryItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Apartados con vencimiento (ADR-062)
-- =============================================================================

SELECT app_enable_tenant_rls('"InventoryReservation"');
SELECT app_enable_tenant_rls('"InventoryReservationLine"');

ALTER TABLE "InventoryReservation"
  -- "Para" breve e mai vuoto; nota breve.
  ADD CONSTRAINT "InventoryReservation_label_check"
    CHECK (char_length(btrim("label")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "InventoryReservation_note_check"
    CHECK ("note" IS NULL OR char_length("note") <= 300),
  -- Chiuso (usato o liberato) se e solo se ha la data di chiusura; il registro di uso solo se usato.
  ADD CONSTRAINT "InventoryReservation_closed_check"
    CHECK (("status" = 'ACTIVE') = ("closedAt" IS NULL)),
  ADD CONSTRAINT "InventoryReservation_used_entry_check"
    CHECK ("usedEntryId" IS NULL OR "status" = 'USED');

-- Quantità positive nei limiti dell'inventario; quanto si è usato non è mai negativo.
ALTER TABLE "InventoryReservationLine"
  ADD CONSTRAINT "InventoryReservationLine_quantity_check"
    CHECK ("quantity" BETWEEN 1 AND 100000),
  ADD CONSTRAINT "InventoryReservationLine_used_quantity_check"
    CHECK ("usedQuantity" IS NULL OR "usedQuantity" BETWEEN 0 AND 100000);
