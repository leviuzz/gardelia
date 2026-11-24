-- ADR-081: proveedor habitual dei prodotti, durata e raggio dei servizi.

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "serviceDurationMinutes" INTEGER,
ADD COLUMN     "serviceRadiusKm" INTEGER,
ADD COLUMN     "supplierId" UUID;

-- CreateIndex
CREATE INDEX "CatalogItem_tenantId_supplierId_idx" ON "CatalogItem"("tenantId", "supplierId");

-- AddForeignKey: stesso tenant per costruzione (FK composita). I proveedores si archiviano, mai
-- si cancellano: RESTRICT.
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nei servizi il "tiempo de preparación" faceva da durata: diventa la durata del servizio, e il
-- tempo di preparazione resta ai prodotti (ramos, piante…). La tabella ha FORCE ROW LEVEL SECURITY:
-- il bypass vale solo per questo aggiornamento, come in 20261121065056_bouquet_builder.
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CatalogItem"
SET "serviceDurationMinutes" = CASE WHEN "prepMinutes" BETWEEN 1 AND 1440 THEN "prepMinutes" END,
    "prepMinutes" = NULL
WHERE "type" IN ('SERVICE', 'SERVICE_ADDON') AND "prepMinutes" IS NOT NULL;
SELECT set_config('app.bypass_rls', '', false);

-- Durata (fino a 24 ore) e raggio (fino a 200 km) solo per i servizi; i servizi non hanno proveedor
-- né tempo di preparazione.
ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_serviceDuration_check" CHECK (
    "serviceDurationMinutes" IS NULL OR "serviceDurationMinutes" BETWEEN 1 AND 1440
  ),
  ADD CONSTRAINT "CatalogItem_serviceRadius_check" CHECK (
    "serviceRadiusKm" IS NULL OR "serviceRadiusKm" BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "CatalogItem_service_fields_check" CHECK (
    ("serviceDurationMinutes" IS NULL AND "serviceRadiusKm" IS NULL)
    OR "type" IN ('SERVICE', 'SERVICE_ADDON')
  ),
  ADD CONSTRAINT "CatalogItem_supplier_type_check" CHECK (
    "supplierId" IS NULL OR "type" NOT IN ('SERVICE', 'SERVICE_ADDON')
  ),
  ADD CONSTRAINT "CatalogItem_service_prep_check" CHECK (
    "prepMinutes" IS NULL OR "type" NOT IN ('SERVICE', 'SERVICE_ADDON')
  );
