-- AlterTable
ALTER TABLE "InventoryEntry" ADD COLUMN     "purchasedOn" DATE,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "supplierId" UUID;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "totalCostMinor" INTEGER;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_tenantId_status_name_idx" ON "Supplier"("tenantId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_id_key" ON "Supplier"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Compras al mayorista e proveedores (ADR-061)
-- =============================================================================

SELECT app_enable_tenant_rls('"Supplier"');

ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_archived_check"
    CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

-- Proveedor, factura e giorno solo sulle compras; il giorno c'è sempre su una compra.
ALTER TABLE "InventoryEntry"
  ADD CONSTRAINT "InventoryEntry_purchase_fields_check" CHECK (
    ("kind" = 'PURCHASE') = ("purchasedOn" IS NOT NULL)
    AND ("supplierId" IS NULL OR "kind" = 'PURCHASE')
    AND ("reference" IS NULL OR "kind" = 'PURCHASE')
  );

-- Il totale pagato esiste solo sulle righe di una compra, e non è negativo.
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_total_cost_check" CHECK (
    "totalCostMinor" IS NULL OR ("totalCostMinor" >= 0 AND "kind" = 'PURCHASE')
  );
