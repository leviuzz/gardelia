-- Marketplace M3 (revisione del blocco, ADR-088): la chiave del modulo di «Registra pagamento» e
-- «Registra rimborso». Lo stesso invio arrivato due volte (rete lenta, due schede) non scrive due
-- movimenti, come `CarePayment.submitKey`. Facoltativa: i pagamenti di prima e quelli creati dalle
-- prove o dai contanti (già protetti dal loro stato) non l'hanno.

-- AlterTable
ALTER TABLE "OrderPayment" ADD COLUMN     "submitKey" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_tenantId_submitKey_key" ON "OrderPayment"("tenantId", "submitKey");
