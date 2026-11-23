-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "bouquetPhotoId" UUID;

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_bouquetPhotoId_idx" ON "OrderLine"("tenantId", "bouquetPhotoId");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_bouquetPhotoId_fkey" FOREIGN KEY ("tenantId", "bouquetPhotoId") REFERENCES "BouquetPhoto"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Solo le righe nate dal Diseñador hanno la foto del ramo (come per i preventivi, ADR-052).
ALTER TABLE "OrderLine"
  ADD CONSTRAINT "OrderLine_photo_builder_check" CHECK ("bouquetPhotoId" IS NULL OR "kind" = 'BUILDER');
