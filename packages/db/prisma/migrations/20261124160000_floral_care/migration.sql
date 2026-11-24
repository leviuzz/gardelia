-- Floral Care e suscripciones dei clienti (ADR-075, blocco 1):
--  - offerta della fioreria (tariffa per uscita, care per misura, frequenze, raggio, regole), fasce
--    di sovrapprezzo per distanza, servizi (lista nostra più quelli del fiorista) e fasce di uscita
--    per giorno della settimana con capienza;
--  - contratti con i clienti (CustomerSubscription), fasce e servizi scelti, piante della sede;
--  - visite, uniche per contratto, versione del calendario e data originale.
-- Tutto con RLS della fioreria, FK composite, CHECK sui valori; niente si cancella.

-- CreateEnum
CREATE TYPE "CareFrequency" AS ENUM ('MONTHLY_1', 'MONTHLY_2', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CareMissedVisitPolicy" AS ENUM ('COUNTS', 'RECOVER');

-- CreateEnum
CREATE TYPE "CareDeadPlantPolicy" AS ENUM ('INCLUDED', 'QUOTE');

-- CreateEnum
CREATE TYPE "CareServicePricing" AS ENUM ('INCLUDED', 'EXTRA');

-- CreateEnum
CREATE TYPE "CareServiceUnit" AS ENUM ('PER_VISIT', 'PER_PLANT', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "PlantSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "PlantLight" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CustomerSubscriptionKind" AS ENUM ('CARE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "CustomerSubscriptionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CareVisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'NOT_DONE', 'CANCELLED', 'TO_RESCHEDULE');

-- CreateEnum
CREATE TYPE "CareVisitCancelReason" AS ENUM ('SCHEDULE_CHANGE', 'CONTRACT_END', 'SHOP', 'CUSTOMER');

-- CreateTable
CREATE TABLE "CareSettings" (
    "tenantId" UUID NOT NULL,
    "visitFeeMinor" INTEGER NOT NULL,
    "careFeeSmallMinor" INTEGER NOT NULL DEFAULT 0,
    "careFeeMediumMinor" INTEGER NOT NULL DEFAULT 0,
    "careFeeLargeMinor" INTEGER NOT NULL DEFAULT 0,
    "frequencies" "CareFrequency"[],
    "maxDistanceKm" INTEGER,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 24,
    "missedVisitPolicy" "CareMissedVisitPolicy" NOT NULL DEFAULT 'COUNTS',
    "deadPlantPolicy" "CareDeadPlantPolicy" NOT NULL DEFAULT 'QUOTE',
    "termsText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "CareTravelTier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "maxMeters" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTravelTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareService" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "presetKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricing" "CareServicePricing" NOT NULL,
    "unit" "CareServiceUnit" NOT NULL DEFAULT 'PER_VISIT',
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareSlot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "CustomerSubscriptionKind" NOT NULL,
    "status" "CustomerSubscriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "customerAddressId" UUID,
    "frequency" "CareFrequency",
    "seats" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
    "priceVersion" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "visitFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "careFeeSmallMinor" INTEGER NOT NULL DEFAULT 0,
    "careFeeMediumMinor" INTEGER NOT NULL DEFAULT 0,
    "careFeeLargeMinor" INTEGER NOT NULL DEFAULT 0,
    "travelSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
    "perVisitMinor" INTEGER NOT NULL DEFAULT 0,
    "oneTimeMinor" INTEGER NOT NULL DEFAULT 0,
    "distanceMeters" INTEGER,
    "outOfRange" BOOLEAN NOT NULL DEFAULT false,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "accessNotes" TEXT,
    "notes" TEXT,
    "generatedUntil" DATE,
    "acquisitionSource" "AcquisitionSource" NOT NULL DEFAULT 'MERCHANT_DIRECT',
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSubscriptionSlot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSubscriptionSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSubscriptionService" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pricing" "CareServicePricing" NOT NULL,
    "unit" "CareServiceUnit" NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSubscriptionService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalFlowerId" UUID,
    "quantity" INTEGER NOT NULL,
    "size" "PlantSize" NOT NULL,
    "location" TEXT,
    "light" "PlantLight",
    "watering" TEXT,
    "instructions" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareVisit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "originalDate" DATE NOT NULL,
    "scheduledDate" DATE,
    "slotId" UUID,
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "CareVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "isExtra" BOOLEAN NOT NULL DEFAULT false,
    "assignedMembershipId" UUID,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelReason" "CareVisitCancelReason",
    "outcomeNote" TEXT,
    "closedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareTravelTier_tenantId_idx" ON "CareTravelTier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CareTravelTier_tenantId_id_key" ON "CareTravelTier"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareTravelTier_tenantId_maxMeters_key" ON "CareTravelTier"("tenantId", "maxMeters");

-- CreateIndex
CREATE INDEX "CareService_tenantId_status_idx" ON "CareService"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareService_tenantId_id_key" ON "CareService"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareService_tenantId_presetKey_key" ON "CareService"("tenantId", "presetKey");

-- CreateIndex
CREATE INDEX "CareSlot_tenantId_weekday_idx" ON "CareSlot"("tenantId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "CareSlot_tenantId_id_key" ON "CareSlot"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerSubscription_tenantId_status_idx" ON "CustomerSubscription"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomerSubscription_tenantId_customerId_idx" ON "CustomerSubscription"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscription_tenantId_id_key" ON "CustomerSubscription"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscription_tenantId_number_key" ON "CustomerSubscription"("tenantId", "number");

-- CreateIndex
CREATE INDEX "CustomerSubscriptionSlot_tenantId_slotId_idx" ON "CustomerSubscriptionSlot"("tenantId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscriptionSlot_tenantId_id_key" ON "CustomerSubscriptionSlot"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscriptionSlot_tenantId_subscriptionId_slotId_key" ON "CustomerSubscriptionSlot"("tenantId", "subscriptionId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscriptionService_tenantId_id_key" ON "CustomerSubscriptionService"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSubscriptionService_tenantId_subscriptionId_service_key" ON "CustomerSubscriptionService"("tenantId", "subscriptionId", "serviceId");

-- CreateIndex
CREATE INDEX "CarePlant_tenantId_subscriptionId_idx" ON "CarePlant"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlant_tenantId_id_key" ON "CarePlant"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CareVisit_tenantId_scheduledDate_idx" ON "CareVisit"("tenantId", "scheduledDate");

-- CreateIndex
CREATE INDEX "CareVisit_tenantId_slotId_scheduledDate_idx" ON "CareVisit"("tenantId", "slotId", "scheduledDate");

-- CreateIndex
CREATE INDEX "CareVisit_tenantId_subscriptionId_idx" ON "CareVisit"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CareVisit_tenantId_id_key" ON "CareVisit"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CareSettings" ADD CONSTRAINT "CareSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTravelTier" ADD CONSTRAINT "CareTravelTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareService" ADD CONSTRAINT "CareService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareSlot" ADD CONSTRAINT "CareSlot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_tenantId_customerAddressId_fkey" FOREIGN KEY ("tenantId", "customerAddressId") REFERENCES "CustomerAddress"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionSlot" ADD CONSTRAINT "CustomerSubscriptionSlot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionSlot" ADD CONSTRAINT "CustomerSubscriptionSlot_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionSlot" ADD CONSTRAINT "CustomerSubscriptionSlot_tenantId_slotId_fkey" FOREIGN KEY ("tenantId", "slotId") REFERENCES "CareSlot"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionService" ADD CONSTRAINT "CustomerSubscriptionService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionService" ADD CONSTRAINT "CustomerSubscriptionService_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscriptionService" ADD CONSTRAINT "CustomerSubscriptionService_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "CareService"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlant" ADD CONSTRAINT "CarePlant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlant" ADD CONSTRAINT "CarePlant_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlant" ADD CONSTRAINT "CarePlant_canonicalFlowerId_fkey" FOREIGN KEY ("canonicalFlowerId") REFERENCES "CanonicalFlower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_slotId_fkey" FOREIGN KEY ("tenantId", "slotId") REFERENCES "CareSlot"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_assignedMembershipId_fkey" FOREIGN KEY ("tenantId", "assignedMembershipId") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- RLS della fioreria su tutte le tabelle nuove
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"CareSettings"');
SELECT app_enable_tenant_rls('"CareTravelTier"');
SELECT app_enable_tenant_rls('"CareService"');
SELECT app_enable_tenant_rls('"CareSlot"');
SELECT app_enable_tenant_rls('"CustomerSubscription"');
SELECT app_enable_tenant_rls('"CustomerSubscriptionSlot"');
SELECT app_enable_tenant_rls('"CustomerSubscriptionService"');
SELECT app_enable_tenant_rls('"CarePlant"');
SELECT app_enable_tenant_rls('"CareVisit"');

-- -----------------------------------------------------------------------------
-- Vincoli sui valori
-- -----------------------------------------------------------------------------
ALTER TABLE "CareSettings" ADD CONSTRAINT "CareSettings_money_check" CHECK (
  "visitFeeMinor" BETWEEN 0 AND 1000000000
  AND "careFeeSmallMinor" BETWEEN 0 AND 1000000000
  AND "careFeeMediumMinor" BETWEEN 0 AND 1000000000
  AND "careFeeLargeMinor" BETWEEN 0 AND 1000000000
);
ALTER TABLE "CareSettings" ADD CONSTRAINT "CareSettings_rules_check" CHECK (
  cardinality("frequencies") BETWEEN 1 AND 3
  AND ("maxDistanceKm" IS NULL OR "maxDistanceKm" BETWEEN 1 AND 100)
  AND "minNoticeHours" BETWEEN 0 AND 168
  AND ("termsText" IS NULL OR char_length("termsText") <= 4000)
);

ALTER TABLE "CareTravelTier" ADD CONSTRAINT "CareTravelTier_values_check" CHECK (
  "maxMeters" BETWEEN 100 AND 100000 AND "feeMinor" BETWEEN 0 AND 1000000000
);

ALTER TABLE "CareService" ADD CONSTRAINT "CareService_values_check" CHECK (
  char_length("name") BETWEEN 1 AND 80
  AND ("description" IS NULL OR char_length("description") <= 300)
  AND "priceMinor" BETWEEN 0 AND 1000000000
  -- Un servizio incluso è dentro la tariffa per uscita: niente prezzo suo.
  AND ("pricing" = 'EXTRA' OR ("priceMinor" = 0 AND "unit" = 'PER_VISIT'))
  AND ("pricing" = 'INCLUDED' OR "priceMinor" > 0)
);

ALTER TABLE "CareSlot" ADD CONSTRAINT "CareSlot_values_check" CHECK (
  "weekday" BETWEEN 0 AND 6
  AND "startMinutes" >= 0 AND "endMinutes" <= 1440 AND "startMinutes" < "endMinutes"
  AND "capacity" BETWEEN 1 AND 20
);

ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_values_check" CHECK (
  "number" > 0
  AND "seats" BETWEEN 1 AND 5
  AND "scheduleVersion" >= 1 AND "priceVersion" >= 1
  AND ("endDate" IS NULL OR "endDate" >= "startDate")
  AND "visitFeeMinor" BETWEEN 0 AND 1000000000
  AND "careFeeSmallMinor" BETWEEN 0 AND 1000000000
  AND "careFeeMediumMinor" BETWEEN 0 AND 1000000000
  AND "careFeeLargeMinor" BETWEEN 0 AND 1000000000
  AND "travelSurchargeMinor" BETWEEN 0 AND 1000000000
  AND "perVisitMinor" BETWEEN 0 AND 1000000000
  AND "oneTimeMinor" BETWEEN 0 AND 1000000000
  AND ("distanceMeters" IS NULL OR "distanceMeters" >= 0)
);
-- Un contratto di Floral Care ha sempre sede e frequenza. Attivo, in pausa o finito = confermato;
-- CANCELLED è solo la bozza scartata, mai confermata.
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_care_check" CHECK (
  "kind" <> 'CARE' OR ("customerAddressId" IS NOT NULL AND "frequency" IS NOT NULL)
);
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_confirmed_check" CHECK (
  ("status" IN ('DRAFT', 'CANCELLED')) = ("confirmedAt" IS NULL)
);
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_ended_check" CHECK (
  ("status" = 'ENDED') = ("endedAt" IS NOT NULL)
);

ALTER TABLE "CustomerSubscriptionService" ADD CONSTRAINT "CustomerSubscriptionService_values_check" CHECK (
  "priceMinor" BETWEEN 0 AND 1000000000
);

ALTER TABLE "CarePlant" ADD CONSTRAINT "CarePlant_values_check" CHECK (
  char_length("name") BETWEEN 1 AND 80
  AND "quantity" BETWEEN 1 AND 500
);

ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_values_check" CHECK (
  "seats" BETWEEN 1 AND 5
  AND "scheduleVersion" >= 1
  -- Data, fascia e orari vanno insieme: tutti o nessuno.
  AND (("scheduledDate" IS NULL) = ("slotId" IS NULL))
  AND (("scheduledDate" IS NULL) = ("startMinutes" IS NULL))
  AND (("scheduledDate" IS NULL) = ("endMinutes" IS NULL))
  AND ("startMinutes" IS NULL OR ("startMinutes" >= 0 AND "endMinutes" <= 1440 AND "startMinutes" < "endMinutes"))
);
-- Una visita programmata, in corso o chiusa ha sempre il suo giorno; "Por reprogramar" no.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_status_date_check" CHECK (
  ("status" IN ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'NOT_DONE') AND "scheduledDate" IS NOT NULL)
  OR ("status" = 'TO_RESCHEDULE' AND "scheduledDate" IS NULL)
  OR "status" = 'CANCELLED'
);
-- Una visita cancellata dice sempre perché; le altre no.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_cancel_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelReason" IS NOT NULL)
);

-- Generare due volte non crea doppioni: una visita per contratto, versione e data originale
-- (le visite extra restano fuori).
CREATE UNIQUE INDEX "CareVisit_generation_key" ON "CareVisit"("tenantId", "subscriptionId", "scheduleVersion", "originalDate")
  WHERE NOT "isExtra";

-- -----------------------------------------------------------------------------
-- Manutenzione: i contratti attivi le cui visite non arrivano ancora fino all'orizzonte
-- (calendario di ogni fioreria). Solo gli ID, come le altre funzioni dei lavori giornalieri.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_care_contracts_to_extend(horizon_days integer, max_rows integer)
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
    SELECT s."tenantId", s.id
    FROM "CustomerSubscription" s
    JOIN "Tenant" t ON t.id = s."tenantId"
    WHERE s.kind = 'CARE'
      AND s.status = 'ACTIVE'
      AND t.status = 'ACTIVE'
      AND (
        s."generatedUntil" IS NULL
        OR s."generatedUntil" < (now() AT TIME ZONE t.timezone)::date + horizon_days
      )
      AND (s."endDate" IS NULL OR s."generatedUntil" IS NULL OR s."generatedUntil" < s."endDate")
    ORDER BY s."generatedUntil" NULLS FIRST, s.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- I contratti attivi il cui ultimo giorno è passato (calendario di ogni fioreria): la
-- manutenzione li chiude. Solo gli ID, come sopra.
CREATE FUNCTION app_care_contracts_to_close(max_rows integer)
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
    SELECT s."tenantId", s.id
    FROM "CustomerSubscription" s
    JOIN "Tenant" t ON t.id = s."tenantId"
    WHERE s.kind = 'CARE'
      AND s.status IN ('ACTIVE', 'PAUSED')
      AND t.status = 'ACTIVE'
      AND s."endDate" IS NOT NULL
      AND s."endDate" < (now() AT TIME ZONE t.timezone)::date
    ORDER BY s."endDate", s.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
