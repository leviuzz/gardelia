-- Floral Care, blocco 4 (ADR-083): giorni bloccati (vacanze, giorni di punta, un orario tolto),
-- le visite spostate o cancellate insieme e l'avviso per email ai clienti toccati.

-- CreateEnum
CREATE TYPE "CareBlockAction" AS ENUM ('MOVE', 'CANCEL');

-- CreateEnum
CREATE TYPE "CareBlockOutcome" AS ENUM ('MOVED', 'TO_RESCHEDULE', 'CANCELLED');

-- AlterEnum: il valore nuovo non si usa in questa migrazione (Postgres non lo permette prima
-- del commit): i vincoli sotto nominano solo VISIT_REPORT.
ALTER TYPE "CareEmailKind" ADD VALUE 'BLOCK_NOTICE';

-- AlterTable
ALTER TABLE "CareEmail" ADD COLUMN     "blockId" UUID;

-- CreateTable
CREATE TABLE "CareBlock" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "slotId" UUID,
    "label" TEXT NOT NULL,
    "action" "CareBlockAction" NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,

    CONSTRAINT "CareBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareBlockVisit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "outcome" "CareBlockOutcome" NOT NULL,
    "fromDate" DATE NOT NULL,
    "fromStartMinutes" INTEGER,
    "fromEndMinutes" INTEGER,
    "toDate" DATE,
    "toStartMinutes" INTEGER,
    "toEndMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareBlockVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareBlock_tenantId_endDate_idx" ON "CareBlock"("tenantId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CareBlock_tenantId_id_key" ON "CareBlock"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CareBlockVisit_tenantId_blockId_subscriptionId_idx" ON "CareBlockVisit"("tenantId", "blockId", "subscriptionId");

-- CreateIndex
CREATE INDEX "CareBlockVisit_tenantId_subscriptionId_visitId_idx" ON "CareBlockVisit"("tenantId", "subscriptionId", "visitId");

-- CreateIndex
CREATE UNIQUE INDEX "CareBlockVisit_tenantId_id_key" ON "CareBlockVisit"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareBlockVisit_tenantId_blockId_visitId_key" ON "CareBlockVisit"("tenantId", "blockId", "visitId");

-- CreateIndex
CREATE INDEX "CareEmail_tenantId_blockId_idx" ON "CareEmail"("tenantId", "blockId");

-- AddForeignKey
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_tenantId_blockId_fkey" FOREIGN KEY ("tenantId", "blockId") REFERENCES "CareBlock"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlock" ADD CONSTRAINT "CareBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlock" ADD CONSTRAINT "CareBlock_tenantId_slotId_fkey" FOREIGN KEY ("tenantId", "slotId") REFERENCES "CareSlot"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlockVisit" ADD CONSTRAINT "CareBlockVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlockVisit" ADD CONSTRAINT "CareBlockVisit_tenantId_blockId_fkey" FOREIGN KEY ("tenantId", "blockId") REFERENCES "CareBlock"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlockVisit" ADD CONSTRAINT "CareBlockVisit_tenantId_subscriptionId_visitId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "visitId") REFERENCES "CareVisit"("tenantId", "subscriptionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBlockVisit" ADD CONSTRAINT "CareBlockVisit_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"CareBlock"');
SELECT app_enable_tenant_rls('"CareBlockVisit"');

-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede)
-- -----------------------------------------------------------------------------

-- Un blocco va dal primo all'ultimo giorno, al massimo 92 giorni; il nome c'è; chi lo toglie va
-- con la data.
ALTER TABLE "CareBlock" ADD CONSTRAINT "CareBlock_values_check" CHECK (
  "endDate" >= "startDate"
  AND "endDate" - "startDate" <= 91
  AND char_length("label") BETWEEN 1 AND 80
  AND ("removedById" IS NULL OR "removedAt" IS NOT NULL)
);

-- Solo una visita spostata ha il giorno e l'orario nuovi, sempre completi.
ALTER TABLE "CareBlockVisit" ADD CONSTRAINT "CareBlockVisit_values_check" CHECK (
  (("outcome" = 'MOVED') = ("toDate" IS NOT NULL))
  AND (("toDate" IS NULL) = ("toStartMinutes" IS NULL))
  AND (("toStartMinutes" IS NULL) = ("toEndMinutes" IS NULL))
  AND (("fromStartMinutes" IS NULL) = ("fromEndMinutes" IS NULL))
);

-- Il resoconto è di una visita, l'avviso di un blocco (per contratto): mai tutti e due.
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_block_check" CHECK (
  (("kind" = 'VISIT_REPORT') = ("blockId" IS NULL))
  AND ("blockId" IS NULL OR "visitId" IS NULL)
);
-- Un avviso per blocco e contratto: un secondo invio dello stesso modulo non lo raddoppia.
CREATE UNIQUE INDEX "CareEmail_block_notice_key" ON "CareEmail"("tenantId", "blockId", "subscriptionId")
  WHERE "blockId" IS NOT NULL;
