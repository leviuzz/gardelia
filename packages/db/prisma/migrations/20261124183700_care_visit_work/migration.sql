-- Floral Care, blocco 2 (ADR-078): la visita dal telefono. Checklist dei servizi, stato delle
-- piante, materiali, foto, avvisi per chi gestisce, email al cliente e link del resoconto.
-- Il vincolo che usa il nuovo valore 'CARE_VISIT' di PublicLinkKind è nella migrazione
-- successiva: un valore aggiunto con ALTER TYPE … ADD VALUE non è utilizzabile nella stessa
-- transazione.

-- CreateEnum
CREATE TYPE "CarePlantCondition" AS ENUM ('OK', 'ATTENTION', 'PROBLEM', 'DEAD');

-- CreateEnum
CREATE TYPE "CareServiceOutcome" AS ENUM ('DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CareFollowUpKind" AS ENUM ('REPLACEMENT', 'EXTRA', 'OTHER');

-- CreateEnum
CREATE TYPE "CareFollowUpStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CareEmailKind" AS ENUM ('VISIT_REPORT');

-- CreateEnum
CREATE TYPE "CareEmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterEnum
ALTER TYPE "PublicLinkKind" ADD VALUE 'CARE_VISIT';

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "inventoryEntryId" UUID,
ADD COLUMN     "startedById" UUID;

-- AlterTable
ALTER TABLE "PublicLink" ADD COLUMN     "careVisitId" UUID;

-- CreateTable
CREATE TABLE "CareVisitServiceResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pricing" "CareServicePricing" NOT NULL,
    "unit" "CareServiceUnit" NOT NULL,
    "outcome" "CareServiceOutcome" NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareVisitServiceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareVisitPlantResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "plantName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "CarePlantCondition" NOT NULL,
    "affected" INTEGER,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareVisitPlantResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareVisitMaterial" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareVisitMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePhoto" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "visitId" UUID,
    "plantId" UUID,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadKey" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CarePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareFollowUp" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "kind" "CareFollowUpKind" NOT NULL,
    "plantId" UUID,
    "quantity" INTEGER,
    "note" TEXT,
    "status" "CareFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareEmail" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "CareEmailKind" NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "visitId" UUID,
    "status" "CareEmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitServiceResult_tenantId_id_key" ON "CareVisitServiceResult"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitServiceResult_tenantId_visitId_serviceId_key" ON "CareVisitServiceResult"("tenantId", "visitId", "serviceId");

-- CreateIndex
CREATE INDEX "CareVisitPlantResult_tenantId_plantId_idx" ON "CareVisitPlantResult"("tenantId", "plantId");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitPlantResult_tenantId_id_key" ON "CareVisitPlantResult"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitPlantResult_tenantId_visitId_plantId_key" ON "CareVisitPlantResult"("tenantId", "visitId", "plantId");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitMaterial_tenantId_id_key" ON "CareVisitMaterial"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisitMaterial_tenantId_visitId_catalogItemId_key" ON "CareVisitMaterial"("tenantId", "visitId", "catalogItemId");

-- CreateIndex
CREATE INDEX "CarePhoto_tenantId_visitId_idx" ON "CarePhoto"("tenantId", "visitId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePhoto_tenantId_id_key" ON "CarePhoto"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePhoto_tenantId_visitId_uploadKey_key" ON "CarePhoto"("tenantId", "visitId", "uploadKey");

-- CreateIndex
CREATE INDEX "CareFollowUp_tenantId_status_idx" ON "CareFollowUp"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CareFollowUp_tenantId_visitId_idx" ON "CareFollowUp"("tenantId", "visitId");

-- CreateIndex
CREATE UNIQUE INDEX "CareFollowUp_tenantId_id_key" ON "CareFollowUp"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareEmail_tenantId_id_key" ON "CareEmail"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareEmail_tenantId_visitId_kind_key" ON "CareEmail"("tenantId", "visitId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisit_tenantId_inventoryEntryId_key" ON "CareVisit"("tenantId", "inventoryEntryId");

-- CreateIndex
CREATE INDEX "PublicLink_tenantId_careVisitId_idx" ON "PublicLink"("tenantId", "careVisitId");

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_tenantId_careVisitId_fkey" FOREIGN KEY ("tenantId", "careVisitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_inventoryEntryId_fkey" FOREIGN KEY ("tenantId", "inventoryEntryId") REFERENCES "InventoryEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitServiceResult" ADD CONSTRAINT "CareVisitServiceResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitServiceResult" ADD CONSTRAINT "CareVisitServiceResult_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitServiceResult" ADD CONSTRAINT "CareVisitServiceResult_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "CareService"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitPlantResult" ADD CONSTRAINT "CareVisitPlantResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitPlantResult" ADD CONSTRAINT "CareVisitPlantResult_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitPlantResult" ADD CONSTRAINT "CareVisitPlantResult_tenantId_plantId_fkey" FOREIGN KEY ("tenantId", "plantId") REFERENCES "CarePlant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitMaterial" ADD CONSTRAINT "CareVisitMaterial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitMaterial" ADD CONSTRAINT "CareVisitMaterial_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisitMaterial" ADD CONSTRAINT "CareVisitMaterial_tenantId_catalogItemId_fkey" FOREIGN KEY ("tenantId", "catalogItemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_tenantId_plantId_fkey" FOREIGN KEY ("tenantId", "plantId") REFERENCES "CarePlant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_plantId_fkey" FOREIGN KEY ("tenantId", "plantId") REFERENCES "CarePlant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_tenantId_visitId_fkey" FOREIGN KEY ("tenantId", "visitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Sicurezza e integrità (ADR-078)
-- =============================================================================

SELECT app_enable_tenant_rls('"CareVisitServiceResult"');
SELECT app_enable_tenant_rls('"CareVisitPlantResult"');
SELECT app_enable_tenant_rls('"CareVisitMaterial"');
SELECT app_enable_tenant_rls('"CarePhoto"');
SELECT app_enable_tenant_rls('"CareFollowUp"');
SELECT app_enable_tenant_rls('"CareEmail"');

-- Una visita in corso sa quando è iniziata; hecha o no realizada ha sempre la fine (e solo
-- loro); i materiali escono solo da una visita hecha. Le righe del blocco 1 lo rispettano già.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_work_check" CHECK (
  ("status" <> 'IN_PROGRESS' OR "startedAt" IS NOT NULL)
  AND (("status" IN ('DONE', 'NOT_DONE')) = ("finishedAt" IS NOT NULL))
  AND ("inventoryEntryId" IS NULL OR "status" = 'DONE')
) NOT VALID;
ALTER TABLE "CareVisit" VALIDATE CONSTRAINT "CareVisit_work_check";

ALTER TABLE "CareVisitServiceResult" ADD CONSTRAINT "CareVisitServiceResult_values_check" CHECK (
  char_length("name") BETWEEN 1 AND 80
  AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 300)
);

-- In un gruppo, le piante toccate sono fra 1 e quante ce ne sono; una pianta che sta bene non ne ha.
ALTER TABLE "CareVisitPlantResult" ADD CONSTRAINT "CareVisitPlantResult_values_check" CHECK (
  char_length("plantName") BETWEEN 1 AND 80
  AND "quantity" BETWEEN 1 AND 500
  AND ("affected" IS NULL OR "affected" BETWEEN 1 AND "quantity")
  AND ("condition" <> 'OK' OR "affected" IS NULL)
  AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 300)
);

ALTER TABLE "CareVisitMaterial" ADD CONSTRAINT "CareVisitMaterial_values_check" CHECK (
  "quantity" BETWEEN 1 AND 100000
);

-- File privati della fioreria sotto care-photos/; una foto tolta dice chi l'ha tolta.
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_values_check" CHECK (
  "storageKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND "width" > 0 AND "height" > 0 AND "sizeBytes" > 0
  AND ("visitId" IS NOT NULL OR "plantId" IS NOT NULL)
  AND (("removedAt" IS NULL) = ("removedById" IS NULL))
  AND ("deletedAt" IS NULL OR "deletedAt" >= "createdAt")
);
-- Il lavoro che cancella le foto cerca quelle ancora con i file, contratto per contratto.
CREATE INDEX "CarePhoto_files_idx" ON "CarePhoto"("tenantId", "subscriptionId")
  WHERE "deletedAt" IS NULL;

-- Un avviso creato a mano ha sempre la nota; quello di reposición di una pianta morta può non
-- averla. Atteso ⇔ data dell'attesa.
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_values_check" CHECK (
  ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500)
  AND ("kind" = 'REPLACEMENT' OR "note" IS NOT NULL)
  AND ("quantity" IS NULL OR "quantity" BETWEEN 1 AND 500)
  AND ("resolutionNote" IS NULL OR char_length("resolutionNote") BETWEEN 1 AND 500)
  AND (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL))
);
-- Una sola reposición per pianta e visita (quella automatica non raddoppia quella a mano).
CREATE UNIQUE INDEX "CareFollowUp_replacement_key" ON "CareFollowUp"("tenantId", "visitId", "plantId")
  WHERE "kind" = 'REPLACEMENT' AND "plantId" IS NOT NULL;

-- Al massimo 3 tentativi; inviata ⇔ data d'invio; il resoconto è sempre di una visita. L'errore è
-- un codice, mai il testo del provider (può contenere l'indirizzo).
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_values_check" CHECK (
  "attempts" BETWEEN 0 AND 3
  AND (("status" = 'SENT') = ("sentAt" IS NOT NULL))
  AND ("kind" <> 'VISIT_REPORT' OR "visitId" IS NOT NULL)
  AND ("lastError" IS NULL OR char_length("lastError") BETWEEN 1 AND 60)
);
-- Il lavoro che riprova le email cerca solo quelle ancora aperte.
CREATE INDEX "CareEmail_open_idx" ON "CareEmail"("createdAt")
  WHERE "status" IN ('PENDING', 'SENDING', 'FAILED');

-- -----------------------------------------------------------------------------
-- Manutenzione: i contratti con foto da cancellare dallo storage (R2). Una foto si cancella 30
-- giorni dopo l'ultimo giorno di un contratto finito (calendario della fioreria), oppure subito
-- se è stata tolta e la cancellazione dopo il commit non è riuscita. Solo gli ID, come le altre
-- funzioni dei lavori giornalieri; il lavoro ricontrolla tutto nel contesto della fioreria.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_care_photos_to_purge(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, subscription_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT p."tenantId", p."subscriptionId"
    FROM "CarePhoto" p
    JOIN "CustomerSubscription" s ON s."tenantId" = p."tenantId" AND s.id = p."subscriptionId"
    JOIN "Tenant" t ON t.id = p."tenantId"
    WHERE p."deletedAt" IS NULL
      AND t.status = 'ACTIVE'
      AND (
        p."removedAt" IS NOT NULL
        OR (
          s.status = 'ENDED'
          AND coalesce(
            s."endDate",
            ((s."endedAt" AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)::date
          ) + retention_days <= (now() AT TIME ZONE t.timezone)::date
        )
      )
    GROUP BY p."tenantId", p."subscriptionId"
    ORDER BY min(coalesce(p."removedAt", s."endedAt", p."createdAt")), p."subscriptionId"
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Manutenzione: le email di Floral Care da riprovare. Solo fiorerie attive e LIVE (mai demo);
-- solo email dei 3 giorni passati: un resoconto più vecchio non si manda più. Una PENDING mai presa
-- (l'invio dopo il commit si è interrotto) dopo 10 minuti; una FAILED con meno di 3 tentativi; una
-- SENDING ferma da un'ora, che il lavoro chiude come FAILED senza rimandarla.
CREATE FUNCTION app_care_emails_due(max_rows integer)
RETURNS TABLE (tenant_id uuid, email_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  utc_now timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT e."tenantId", e.id
    FROM "CareEmail" e
    JOIN "Tenant" t ON t.id = e."tenantId"
    WHERE e.status IN ('PENDING', 'SENDING', 'FAILED')
      AND t.status = 'ACTIVE'
      AND t.mode = 'LIVE'
      AND e."createdAt" > utc_now - interval '3 days'
      AND (
        (e.status = 'PENDING' AND e."createdAt" < utc_now - interval '10 minutes')
        OR (e.status = 'FAILED' AND e.attempts < 3)
        OR (e.status = 'SENDING' AND e."updatedAt" < utc_now - interval '60 minutes')
      )
    ORDER BY e."createdAt", e.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
