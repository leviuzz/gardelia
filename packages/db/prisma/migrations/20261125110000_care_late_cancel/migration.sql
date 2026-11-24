-- Cancelación del cliente con orario limite (ADR-082, decisione del founder del 24/11): una visita
-- cancellata dal cliente si paga solo se arriva con meno ore di preavviso del limite della
-- fioreria. Il limite si sceglie in Ajustes → Floral Care (12 di default, 0 = mai) e si copia nel
-- contratto alla conferma, come le altre regole.

-- AlterEnum: il credito di una visita cobrada che il cliente cancella in tempo. Il valore nuovo
-- non si usa in questa migrazione (Postgres non lo permette prima del commit).
ALTER TYPE "CareCreditReason" ADD VALUE 'CUSTOMER';

-- AlterTable
ALTER TABLE "CareSettings" ADD COLUMN     "lateCancelHours" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "CareVisit" ADD COLUMN     "cancelCharged" BOOLEAN;

-- AlterTable
ALTER TABLE "CustomerSubscription" ADD COLUMN     "lateCancelHours" INTEGER;

-- -----------------------------------------------------------------------------
-- Dati di prima (staging): i contratti già confermati prendono il limite di oggi della fioreria;
-- le visite già cancellate dal cliente restano pagate come prima (la regola PROPOSTA del 3a), così
-- i cargos già emessi non cambiano. Le tabelle hanno FORCE RLS: si passa dal bypass come in
-- `care_charges`.
-- -----------------------------------------------------------------------------
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "CustomerSubscription" s
SET "lateCancelHours" = c."lateCancelHours"
FROM "CareSettings" c
WHERE c."tenantId" = s."tenantId" AND s."kind" = 'CARE' AND s."confirmedAt" IS NOT NULL;
UPDATE "CustomerSubscription"
SET "lateCancelHours" = 12
WHERE "kind" = 'CARE' AND "confirmedAt" IS NOT NULL AND "lateCancelHours" IS NULL;
UPDATE "CareVisit"
SET "cancelCharged" = true
WHERE "status" = 'CANCELLED' AND "cancelReason" = 'CUSTOMER';
SELECT set_config('app.bypass_rls', '', false);

-- -----------------------------------------------------------------------------
-- Vincoli (Prisma non li vede)
-- -----------------------------------------------------------------------------
ALTER TABLE "CareSettings" ADD CONSTRAINT "CareSettings_late_cancel_check" CHECK (
  "lateCancelHours" BETWEEN 0 AND 168
);

-- Un contratto di Floral Care confermato ha il suo limite copiato.
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_late_cancel_check" CHECK (
  ("lateCancelHours" IS NULL OR "lateCancelHours" BETWEEN 0 AND 168)
  AND ("kind" <> 'CARE' OR "confirmedAt" IS NULL OR "lateCancelHours" IS NOT NULL)
);

-- "Se cobra" vale solo per una visita cancellata dal cliente, e lei ce l'ha sempre.
ALTER TABLE "CareVisit" ADD CONSTRAINT "CareVisit_cancel_charged_check" CHECK (
  ("cancelCharged" IS NULL) = NOT ("status" = 'CANCELLED' AND "cancelReason" IS NOT DISTINCT FROM 'CUSTOMER')
);
