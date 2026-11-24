-- Scarico dell'inventario dagli ordini (ADR-071): il registro di uso scritto quando l'ordine
-- diventa "Listo". Uno per ordine e un ordine per registro (indice unico); il registro non si
-- cancella mai (FK RESTRICT): un errore si corregge con l'anulación dell'inventario.


-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "inventoryEntryId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_inventoryEntryId_key" ON "Order"("tenantId", "inventoryEntryId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_inventoryEntryId_fkey" FOREIGN KEY ("tenantId", "inventoryEntryId") REFERENCES "InventoryEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

