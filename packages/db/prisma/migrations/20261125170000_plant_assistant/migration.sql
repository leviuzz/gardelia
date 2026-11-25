-- Floral Care, blocco 6a (ADR-085): l'Asistente de plantas.
--  - CanonicalFlower.care: luce, acqua, umidità e tossicità per cani e gatti delle piante in vaso
--    (schema in packages/domain/src/plant-care.ts, valori in reference-data.ts; DA VALIDARE).
--  - AssistantCase (la foto riconosciuta), AssistantAnswer (una consulta = una risposta) e
--    AssistantCall (ogni chiamata al modello con il costo vero). Le consultas si scrivono solo per
--    inserimento: il portale del blocco 6b ci scriverà con policy `portal_insert`.
--  - app_assistant_spend_since: la spesa del mese per il budget, fra tutte le fiorerie.

-- CreateEnum
CREATE TYPE "AssistantChannel" AS ENUM ('SHOP', 'PORTAL');

-- CreateEnum
CREATE TYPE "AssistantCallKind" AS ENUM ('RECOGNIZE', 'ANSWER');

-- CreateEnum
CREATE TYPE "AssistantCallStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUSED');

-- AlterTable
ALTER TABLE "CanonicalFlower" ADD COLUMN     "care" JSONB;

-- CreateTable
CREATE TABLE "AssistantCase" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "plantId" UUID,
    "visitId" UUID,
    "channel" "AssistantChannel" NOT NULL,
    "askedByUserId" UUID,
    "photoUsable" BOOLEAN NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "notInList" BOOLEAN NOT NULL DEFAULT false,
    "condition" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "photoDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAnswer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "channel" "AssistantChannel" NOT NULL,
    "askedByUserId" UUID,
    "speciesId" UUID,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "unsure" BOOLEAN NOT NULL DEFAULT false,
    "askFlorist" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCall" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID,
    "kind" "AssistantCallKind" NOT NULL,
    "status" "AssistantCallStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "servedModel" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantCase_tenantId_subscriptionId_createdAt_idx" ON "AssistantCase"("tenantId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantCase_tenantId_createdAt_idx" ON "AssistantCase"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantCase_askedByUserId_idx" ON "AssistantCase"("askedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCase_tenantId_id_key" ON "AssistantCase"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCase_tenantId_id_subscriptionId_key" ON "AssistantCase"("tenantId", "id", "subscriptionId");

-- CreateIndex
CREATE INDEX "AssistantAnswer_tenantId_caseId_createdAt_idx" ON "AssistantAnswer"("tenantId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAnswer_tenantId_subscriptionId_createdAt_idx" ON "AssistantAnswer"("tenantId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAnswer_tenantId_createdAt_idx" ON "AssistantAnswer"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAnswer_askedByUserId_idx" ON "AssistantAnswer"("askedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantAnswer_tenantId_id_key" ON "AssistantAnswer"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AssistantCall_createdAt_idx" ON "AssistantCall"("createdAt");

-- CreateIndex
CREATE INDEX "AssistantCall_tenantId_createdAt_idx" ON "AssistantCall"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantCall_tenantId_caseId_idx" ON "AssistantCall"("tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCall_tenantId_id_key" ON "AssistantCall"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlant_tenantId_subscriptionId_id_key" ON "CarePlant"("tenantId", "subscriptionId", "id");

-- AddForeignKey
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_tenantId_subscriptionId_customerId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "customerId") REFERENCES "CustomerSubscription"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_tenantId_subscriptionId_plantId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "plantId") REFERENCES "CarePlant"("tenantId", "subscriptionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_tenantId_subscriptionId_visitId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "visitId") REFERENCES "CareVisit"("tenantId", "subscriptionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAnswer" ADD CONSTRAINT "AssistantAnswer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAnswer" ADD CONSTRAINT "AssistantAnswer_tenantId_caseId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "caseId", "subscriptionId") REFERENCES "AssistantCase"("tenantId", "id", "subscriptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAnswer" ADD CONSTRAINT "AssistantAnswer_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "CanonicalFlower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAnswer" ADD CONSTRAINT "AssistantAnswer_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCall" ADD CONSTRAINT "AssistantCall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCall" ADD CONSTRAINT "AssistantCall_tenantId_caseId_fkey" FOREIGN KEY ("tenantId", "caseId") REFERENCES "AssistantCase"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

-- La foto del caso segue le foto delle visite (stessa cartella, cancellata con loro); al massimo
-- 3 candidati della lista; la condizione è breve.
ALTER TABLE "AssistantCase" ADD CONSTRAINT "AssistantCase_values_check" CHECK (
  "storageKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND jsonb_typeof("candidates") = 'array'
  AND jsonb_array_length("candidates") <= 3
  AND char_length("condition") <= 300
  AND ("photoDeletedAt" IS NULL OR "photoDeletedAt" >= "createdAt")
);

-- Domanda di 1–500 caratteri, risposta non vuota e breve, al massimo 5 passi.
ALTER TABLE "AssistantAnswer" ADD CONSTRAINT "AssistantAnswer_values_check" CHECK (
  char_length("question") BETWEEN 1 AND 500
  AND char_length("answer") BETWEEN 1 AND 1200
  AND jsonb_typeof("steps") = 'array'
  AND jsonb_array_length("steps") <= 5
);

-- Token, costo e durata mai negativi; l'errore è un codice breve, presente se non è riuscita.
ALTER TABLE "AssistantCall" ADD CONSTRAINT "AssistantCall_values_check" CHECK (
  "inputTokens" >= 0 AND "outputTokens" >= 0
  AND "cacheCreationTokens" >= 0 AND "cacheReadTokens" >= 0
  AND "costMicros" >= 0 AND "durationMs" >= 0
  AND char_length("model") BETWEEN 1 AND 60
  AND ("servedModel" IS NULL OR char_length("servedModel") BETWEEN 1 AND 60)
  AND char_length("promptVersion") BETWEEN 1 AND 20
  AND ("errorCode" IS NULL OR char_length("errorCode") BETWEEN 1 AND 60)
  AND ("stopReason" IS NULL OR char_length("stopReason") BETWEEN 1 AND 40)
  AND ("status" = 'SUCCEEDED') = ("errorCode" IS NULL)
  -- Senza caso solo un riconoscimento non riuscito (il caso nasce dal riconoscimento riuscito).
  AND ("caseId" IS NOT NULL OR ("kind" = 'RECOGNIZE' AND "status" <> 'SUCCEEDED'))
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"AssistantCase"');
SELECT app_enable_tenant_rls('"AssistantAnswer"');
SELECT app_enable_tenant_rls('"AssistantCall"');

-- -----------------------------------------------------------------------------
-- Budget
-- -----------------------------------------------------------------------------

-- Quanto è costato l'assistente da `since` (UTC), fra tutte le fiorerie: il budget mensile delle
-- consultas pagate da Gardelia. Solo un numero, nessun dato delle fiorerie.
CREATE FUNCTION app_assistant_spend_since(since timestamptz)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  total bigint;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  SELECT coalesce(sum("costMicros"), 0) INTO total
  FROM "AssistantCall"
  WHERE "createdAt" >= (since AT TIME ZONE 'UTC');
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN total;
END
$$;
