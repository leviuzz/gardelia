-- Repartidor (ADR-058, blocco B2): l'ordine si assegna a un membro della fioreria, che dal
-- telefono vede le sue consegne del giorno. Solo gli ordini a domicilio hanno un repartidor.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "assignedMembershipId" UUID;

-- CreateIndex
CREATE INDEX "Order_tenantId_assignedMembershipId_idx" ON "Order"("tenantId", "assignedMembershipId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_assignedMembershipId_fkey" FOREIGN KEY ("tenantId", "assignedMembershipId") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_assignee_delivery_check"
    CHECK ("assignedMembershipId" IS NULL OR "fulfillmentMode" = 'DELIVERY');
