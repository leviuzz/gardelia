-- Apartados dagli ordini confermati (ADR-072).
--  - L'ordine tiene il suo apartado (l'ultimo, anche se già usato o liberato): uno per ordine e un
--    ordine per apartado (indice unico); l'apartado non si cancella mai (FK RESTRICT), come il
--    registro di uso dell'ordine (ADR-071).
--  - "holdsFrom": da quando l'apartado toglie merce dal disponibile (NULL = da subito). Quelli degli
--    ordini tengono solo negli ultimi giorni prima della consegna, così un ordine preso con mesi di
--    anticipo non blocca la merce fresca di oggi.

-- AlterTable
ALTER TABLE "InventoryReservation" ADD COLUMN     "holdsFrom" DATE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "inventoryReservationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_inventoryReservationId_key" ON "Order"("tenantId", "inventoryReservationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_inventoryReservationId_fkey" FOREIGN KEY ("tenantId", "inventoryReservationId") REFERENCES "InventoryReservation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un apartado comincia a tenere al più tardi il giorno in cui scade.
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_holdsFrom_check"
  CHECK ("holdsFrom" IS NULL OR "holdsFrom" <= "expiresOn");
