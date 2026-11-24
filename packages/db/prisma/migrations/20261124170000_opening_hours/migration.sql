-- Orari di apertura della tienda (V1 §2.2): fasce per giorno della settimana, senza limite pratico
-- (deciso dal founder il 24/11/2026). Giorno senza fasce = chiuso.

-- CreateTable
CREATE TABLE "OpeningHoursRange" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningHoursRange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpeningHoursRange_tenantId_idx" ON "OpeningHoursRange"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningHoursRange_tenantId_id_key" ON "OpeningHoursRange"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningHoursRange_tenantId_locationId_weekday_startMinutes_key" ON "OpeningHoursRange"("tenantId", "locationId", "weekday", "startMinutes");

-- AddForeignKey
ALTER TABLE "OpeningHoursRange" ADD CONSTRAINT "OpeningHoursRange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningHoursRange" ADD CONSTRAINT "OpeningHoursRange_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "Location"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrità che Prisma non esprime: giorno 0–6, fascia nello stesso giorno, inizio prima della fine.
ALTER TABLE "OpeningHoursRange"
  ADD CONSTRAINT "OpeningHoursRange_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "OpeningHoursRange_minutes_check"
    CHECK ("startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);

-- Isolamento fra fiorerie.
SELECT app_enable_tenant_rls('"OpeningHoursRange"');
