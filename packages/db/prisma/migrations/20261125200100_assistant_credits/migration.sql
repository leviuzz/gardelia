-- Floral Care, blocco 6b (ADR-085): l'Asistente de plantas è per i clienti della fioreria (Mi Floral
-- Care), con crediti che la fioreria compra da Gardelia (`AiCreditGrant` PLANT_ASSISTANT) e dà ai
-- contratti (`AssistantCreditAllocation`). 1 credito = 1 risposta riuscita del cliente.
--
--  - Saldi calcolati, mai contatori: contratto = assegnati − risposte del portale − riserve attive.
--  - Prima di chiamare il modello il portale riserva un credito (`app_portal_assistant_reserve`,
--    sotto lock del contratto): due domande insieme sull'ultimo credito → una sola passa. La
--    risposta toglie la riserva nella stessa transazione; un errore la rende; scade da sola.
--  - Il portale scrive solo i propri casi, risposte e chiamate (policy `portal_insert`) e legge solo
--    i propri casi e risposte; i crediti li vede solo con le funzioni qui sotto.

-- CreateEnum
CREATE TYPE "AssistantQuestionKind" AS ENUM ('CARE', 'PROBLEM');

-- CreateEnum
CREATE TYPE "AssistantCreditKind" AS ENUM ('GIVE', 'RETURN_ENDED');

-- AlterTable
ALTER TABLE "AssistantAnswer" ADD COLUMN     "kind" "AssistantQuestionKind" NOT NULL DEFAULT 'PROBLEM';

-- AlterTable
ALTER TABLE "AssistantCase" ADD COLUMN     "looksUnhealthy" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AssistantCreditAllocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "kind" "AssistantCreditKind" NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCreditAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCreditHold" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantCreditHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantCreditAllocation_tenantId_subscriptionId_createdAt_idx" ON "AssistantCreditAllocation"("tenantId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantCreditAllocation_createdByUserId_idx" ON "AssistantCreditAllocation"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCreditAllocation_tenantId_id_key" ON "AssistantCreditAllocation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AssistantCreditHold_tenantId_subscriptionId_expiresAt_idx" ON "AssistantCreditHold"("tenantId", "subscriptionId", "expiresAt");

-- CreateIndex
CREATE INDEX "AssistantCreditHold_userId_idx" ON "AssistantCreditHold"("userId");

-- AddForeignKey
ALTER TABLE "AssistantCreditAllocation" ADD CONSTRAINT "AssistantCreditAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditAllocation" ADD CONSTRAINT "AssistantCreditAllocation_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditAllocation" ADD CONSTRAINT "AssistantCreditAllocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditHold" ADD CONSTRAINT "AssistantCreditHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditHold" ADD CONSTRAINT "AssistantCreditHold_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditHold" ADD CONSTRAINT "AssistantCreditHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

-- Dati: da 1 a 500 in una volta; tornati a fine contratto: negativi.
ALTER TABLE "AssistantCreditAllocation" ADD CONSTRAINT "AssistantCreditAllocation_credits_check"
  CHECK (
    ("kind" = 'GIVE' AND "credits" BETWEEN 1 AND 500)
    OR ("kind" = 'RETURN_ENDED' AND "credits" < 0)
  );
-- Una riserva vale al massimo pochi minuti.
ALTER TABLE "AssistantCreditHold" ADD CONSTRAINT "AssistantCreditHold_expires_check"
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '10 minutes');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"AssistantCreditAllocation"');
SELECT app_enable_tenant_rls('"AssistantCreditHold"');

-- Portale: la persona legge solo i propri casi e le proprie risposte del contratto aperto.
SELECT app_enable_portal_read(
  '"AssistantCase"',
  '"subscriptionId" = app_portal_subscription_id() AND "channel" = ''PORTAL'' AND "askedByUserId" = app_current_user_id()'
);
SELECT app_enable_portal_read(
  '"AssistantAnswer"',
  '"subscriptionId" = app_portal_subscription_id() AND "channel" = ''PORTAL'' AND "askedByUserId" = app_current_user_id()'
);

-- Portale: un caso proprio, sul contratto aperto attivo o in pausa, mai a nome della fioreria.
CREATE POLICY portal_insert ON "AssistantCase" FOR INSERT
  WITH CHECK (
    app_portal_subscription_id() IS NOT NULL
    AND "tenantId" = app_portal_tenant_id()
    AND "subscriptionId" = app_portal_subscription_id()
    AND "customerId" = app_portal_customer_id()
    AND "channel" = 'PORTAL'
    AND "askedByUserId" = app_current_user_id()
    AND "visitId" IS NULL
    AND "photoDeletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CustomerSubscription" s
      WHERE s.id = app_portal_subscription_id() AND s.status IN ('ACTIVE', 'PAUSED')
    )
  );

-- Portale: una risposta propria, su un proprio caso del contratto aperto attivo o in pausa.
CREATE POLICY portal_insert ON "AssistantAnswer" FOR INSERT
  WITH CHECK (
    app_portal_subscription_id() IS NOT NULL
    AND "tenantId" = app_portal_tenant_id()
    AND "subscriptionId" = app_portal_subscription_id()
    AND "channel" = 'PORTAL'
    AND "askedByUserId" = app_current_user_id()
    AND EXISTS (
      SELECT 1 FROM "AssistantCase" c
      WHERE c."tenantId" = "AssistantAnswer"."tenantId"
        AND c.id = "AssistantAnswer"."caseId"
        AND c."subscriptionId" = app_portal_subscription_id()
        AND c."channel" = 'PORTAL'
        AND c."askedByUserId" = app_current_user_id()
    )
    AND EXISTS (
      SELECT 1 FROM "CustomerSubscription" s
      WHERE s.id = app_portal_subscription_id() AND s.status IN ('ACTIVE', 'PAUSED')
    )
  );

-- Portale: le chiamate al modello (costo vero per il budget), di un proprio caso o di un
-- riconoscimento fallito (senza caso). Il portale non le legge.
CREATE POLICY portal_insert ON "AssistantCall" FOR INSERT
  WITH CHECK (
    app_portal_subscription_id() IS NOT NULL
    AND "tenantId" = app_portal_tenant_id()
    AND (
      "caseId" IS NULL
      OR EXISTS (
        SELECT 1 FROM "AssistantCase" c
        WHERE c."tenantId" = "AssistantCall"."tenantId"
          AND c.id = "AssistantCall"."caseId"
          AND c."subscriptionId" = app_portal_subscription_id()
          AND c."askedByUserId" = app_current_user_id()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Funzioni dei crediti dal portale (persona e contratto solo dal contesto del portale)
-- -----------------------------------------------------------------------------

-- I crediti del contratto aperto: dati (meno i resi), usati dalle risposte del portale di tutte le
-- persone del cliente, riservati ora; e le risposte e le foto del portale da `since` (il tetto del
-- giorno è per contratto, e il portale vede solo le proprie righe). Nessuna riga fuori dal portale
-- o senza accesso.
CREATE FUNCTION app_portal_assistant_credits(since timestamptz)
RETURNS TABLE (
  allocated integer,
  used integer,
  held integer,
  answers_since integer,
  cases_since integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
  tenant uuid := app_portal_tenant_id();
  sub uuid := app_portal_subscription_id();
  stamp timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  IF person IS NULL OR tenant IS NULL OR sub IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  IF NOT EXISTS (
    SELECT 1 FROM app_portal_visible_contracts(person) v
    WHERE v.tenant_id = tenant AND v.subscription_id = sub
  ) THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN;
  END IF;
  RETURN QUERY SELECT
    (SELECT coalesce(sum(a."credits"), 0)::integer FROM "AssistantCreditAllocation" a
      WHERE a."tenantId" = tenant AND a."subscriptionId" = sub),
    (SELECT count(*)::integer FROM "AssistantAnswer" x
      WHERE x."tenantId" = tenant AND x."subscriptionId" = sub AND x."channel" = 'PORTAL'),
    (SELECT count(*)::integer FROM "AssistantCreditHold" h
      WHERE h."tenantId" = tenant AND h."subscriptionId" = sub AND h."expiresAt" > stamp),
    (SELECT count(*)::integer FROM "AssistantAnswer" x
      WHERE x."tenantId" = tenant AND x."subscriptionId" = sub AND x."channel" = 'PORTAL'
        AND x."createdAt" >= (coalesce(since, now()) AT TIME ZONE 'UTC')),
    (SELECT count(*)::integer FROM "AssistantCase" c
      WHERE c."tenantId" = tenant AND c."subscriptionId" = sub AND c."channel" = 'PORTAL'
        AND c."createdAt" >= (coalesce(since, now()) AT TIME ZONE 'UTC'));
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Riserva un credito prima di chiamare il modello, sotto lock del contratto (attivo o in pausa):
-- restituisce la riserva, o null se non ci sono crediti. Toglie le riserve scadute del contratto.
CREATE FUNCTION app_portal_assistant_reserve(seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
  tenant uuid := app_portal_tenant_id();
  sub uuid := app_portal_subscription_id();
  stamp timestamp := now() AT TIME ZONE 'UTC';
  available integer;
  hold uuid;
BEGIN
  IF person IS NULL OR tenant IS NULL OR sub IS NULL OR seconds < 1 OR seconds > 600 THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  IF NOT EXISTS (
    SELECT 1 FROM app_portal_visible_contracts(person) v
    WHERE v.tenant_id = tenant AND v.subscription_id = sub AND NOT v.read_only
  ) THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN NULL;
  END IF;
  -- Il lock del contratto mette in fila le riserve dello stesso contratto.
  PERFORM 1 FROM "CustomerSubscription" s
    WHERE s."tenantId" = tenant AND s.id = sub AND s.status IN ('ACTIVE', 'PAUSED')
    FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN NULL;
  END IF;
  DELETE FROM "AssistantCreditHold" h
    WHERE h."tenantId" = tenant AND h."subscriptionId" = sub AND h."expiresAt" <= stamp;
  SELECT
    (SELECT coalesce(sum(a."credits"), 0) FROM "AssistantCreditAllocation" a
      WHERE a."tenantId" = tenant AND a."subscriptionId" = sub)
    - (SELECT count(*) FROM "AssistantAnswer" x
      WHERE x."tenantId" = tenant AND x."subscriptionId" = sub AND x."channel" = 'PORTAL')
    - (SELECT count(*) FROM "AssistantCreditHold" h
      WHERE h."tenantId" = tenant AND h."subscriptionId" = sub)
  INTO available;
  IF available < 1 THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN NULL;
  END IF;
  INSERT INTO "AssistantCreditHold" ("id", "tenantId", "subscriptionId", "userId", "createdAt", "expiresAt")
  VALUES (gen_random_uuid(), tenant, sub, person, stamp, stamp + make_interval(secs => seconds))
  RETURNING id INTO hold;
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN hold;
END;
$$;

-- Toglie una propria riserva del contratto aperto: con la risposta (nella stessa transazione,
-- che così usa il credito) o se la chiamata non è riuscita (il credito torna).
CREATE FUNCTION app_portal_assistant_release(hold uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
  tenant uuid := app_portal_tenant_id();
  sub uuid := app_portal_subscription_id();
  removed integer;
BEGIN
  IF person IS NULL OR tenant IS NULL OR sub IS NULL OR hold IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  DELETE FROM "AssistantCreditHold" h
    WHERE h.id = hold AND h."tenantId" = tenant AND h."subscriptionId" = sub AND h."userId" = person;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN removed > 0;
END;
$$;

-- «Descargar mis datos»: le consultas della persona all'Asistente de plantas (domanda e risposta)
-- in tutte le fiorerie. Solo nel contesto della persona (`withUserContext`).
CREATE FUNCTION app_buyer_assistant_answers()
RETURNS TABLE (
  shop_name text,
  contract_number integer,
  created_at timestamp,
  kind text,
  question text,
  answer text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  person uuid := app_current_user_id();
BEGIN
  IF person IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t."displayName", s.number, a."createdAt", a."kind"::text, a.question, a.answer
    FROM "AssistantAnswer" a
    JOIN "Tenant" t ON t.id = a."tenantId"
    JOIN "CustomerSubscription" s ON s."tenantId" = a."tenantId" AND s.id = a."subscriptionId"
    WHERE a."askedByUserId" = person AND a."channel" = 'PORTAL'
    ORDER BY a."createdAt", a.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
