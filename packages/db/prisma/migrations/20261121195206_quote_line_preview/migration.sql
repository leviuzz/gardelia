-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "previewJobId" UUID;

-- CreateIndex
CREATE INDEX "QuoteLine_tenantId_previewJobId_idx" ON "QuoteLine"("tenantId", "previewJobId");

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_tenantId_previewJobId_fkey" FOREIGN KEY ("tenantId", "previewJobId") REFERENCES "AiJob"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo le righe nate dal Builder hanno un'anteprima del ramo.
ALTER TABLE "QuoteLine"
  ADD CONSTRAINT "QuoteLine_preview_builder_check" CHECK ("previewJobId" IS NULL OR "kind" = 'BUILDER');
