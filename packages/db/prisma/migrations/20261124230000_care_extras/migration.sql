-- Floral Care, blocco 2b (ADR-078): visite extra (in un orario di visita o a un'ora libera),
-- piante morte (come si risolve un avviso), cambio di stagione (piante di temporada e
-- cotización legata al contratto). Solo enum nuovi: si usano subito nella stessa migrazione.

-- CreateEnum
CREATE TYPE "CareFollowUpResolution" AS ENUM ('HANDLED', 'FREE_VISIT', 'NEXT_VISIT', 'QUOTED', 'NOT_REPLACED');

-- CreateEnum
CREATE TYPE "CareExtraKind" AS ENUM ('EXTRA', 'REPLACEMENT', 'SEASONAL_INSTALL', 'SEASONAL_PICKUP');

-- CreateEnum
CREATE TYPE "CareExtraFee" AS ENUM ('VISIT_FEE', 'FREE', 'QUOTE');

-- AlterTable
ALTER TABLE "CareFollowUp" ADD COLUMN     "extraVisitId" UUID,
ADD COLUMN     "quoteId" UUID,
ADD COLUMN     "resolution" "CareFollowUpResolution";

-- AlterTable
ALTER TABLE "CarePlant" ADD COLUMN     "seasonal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "extraFee" "CareExtraFee",
ADD COLUMN     "extraFeeMinor" INTEGER,
ADD COLUMN     "extraKind" "CareExtraKind",
ADD COLUMN     "extraNote" TEXT,
ADD COLUMN     "quoteId" UUID;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "subscriptionId" UUID;

-- CreateIndex
CREATE INDEX "CareVisit_tenantId_quoteId_idx" ON "CareVisit"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_subscriptionId_idx" ON "Quote"("tenantId", "subscriptionId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "Quote"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_tenantId_extraVisitId_fkey" FOREIGN KEY ("tenantId", "extraVisitId") REFERENCES "CareVisit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede)
-- -----------------------------------------------------------------------------

-- Una visita extra può avere giorno e ore senza fascia: l'ora libera decisa dal founder il
-- 24/11/2026, che non conta i posti. Le altre visite hanno giorno, fascia e orari insieme.
ALTER TABLE "CareVisit" DROP CONSTRAINT "CareVisit_values_check";
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_values_check" CHECK (
  "seats" BETWEEN 1 AND 5
  AND "scheduleVersion" >= 1
  AND (("scheduledDate" IS NULL) = ("startMinutes" IS NULL))
  AND (("scheduledDate" IS NULL) = ("endMinutes" IS NULL))
  AND ("slotId" IS NULL OR "scheduledDate" IS NOT NULL)
  AND ("isExtra" OR (("scheduledDate" IS NULL) = ("slotId" IS NULL)))
  AND ("startMinutes" IS NULL OR ("startMinutes" >= 0 AND "endMinutes" <= 1440 AND "startMinutes" < "endMinutes"))
);

-- Tipo, costo e importo vanno con le visite extra (e solo con loro). "Sin costo" e "en la
-- cotización" valgono 0 nel canone; "en la cotización" porta sempre la sua cotización.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_extra_check" CHECK (
  ("isExtra" = ("extraKind" IS NOT NULL))
  AND ("isExtra" = ("extraFee" IS NOT NULL))
  AND ("isExtra" = ("extraFeeMinor" IS NOT NULL))
  AND ("extraFeeMinor" IS NULL OR "extraFeeMinor" BETWEEN 0 AND 1000000000)
  AND ("extraFee" IS NULL OR "extraFee" = 'VISIT_FEE' OR "extraFeeMinor" = 0)
  AND (("extraFee" IS NOT DISTINCT FROM 'QUOTE') = ("quoteId" IS NOT NULL))
  AND ("extraNote" IS NULL OR ("isExtra" AND char_length("extraNote") BETWEEN 1 AND 200))
);

-- Gli avvisi risolti nel blocco 2a ("Atendido") hanno la loro risoluzione.
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CareFollowUp" SET "resolution" = 'HANDLED' WHERE "status" = 'RESOLVED';
SELECT set_config('app.bypass_rls', '', false);

-- Un avviso risolto dice come; "Cotizar" porta la cotización e "Reposición sin costo" la sua
-- visita extra. Le scelte della reposición valgono solo per una pianta morta.
ALTER TABLE "CareFollowUp" ADD CONSTRAINT "CareFollowUp_resolution_check" CHECK (
  (("status" = 'RESOLVED') = ("resolution" IS NOT NULL))
  AND (("resolution" IS NOT DISTINCT FROM 'QUOTED') = ("quoteId" IS NOT NULL))
  AND (("resolution" IS NOT DISTINCT FROM 'FREE_VISIT') = ("extraVisitId" IS NOT NULL))
  AND ("resolution" IS NULL OR "resolution" IN ('HANDLED', 'QUOTED') OR "kind" = 'REPLACEMENT')
);
