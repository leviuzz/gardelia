-- Floral Care, blocco 5b (ADR-084): i messaggi fra cliente e fioreria.
--  - Un filo per contratto: scrive la persona invitata (dal portale) o la squadra (tutti i ruoli).
--  - Una foto facoltativa per messaggio, nella stessa tabella delle foto di Floral Care (si
--    cancella con le altre 30 giorni dopo la fine del contratto, e subito se la fioreria la toglie).
--  - Al cliente al massimo un avviso al giorno per contratto (CareEmail MESSAGE_NOTICE); alla
--    fioreria un riassunto al giorno (CareMessageDigest).
--  - Il portale (modalità chiusa del 5a) aggiunge solo: leggere il filo, inserire i propri
--    messaggi con la loro foto e segnare fin dove ha letto. Niente UPDATE né DELETE.

-- CreateEnum
CREATE TYPE "CareMessageAuthor" AS ENUM ('CUSTOMER', 'SHOP');

-- AlterTable
ALTER TABLE "CareEmail" ADD COLUMN     "noticeDay" DATE;

-- AlterTable
ALTER TABLE "CarePhoto" ADD COLUMN     "messageId" UUID;

-- CreateTable
CREATE TABLE "CareMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "authorKind" "CareMessageAuthor" NOT NULL,
    "authorUserId" UUID,
    "body" TEXT NOT NULL DEFAULT '',
    "hasPhoto" BOOLEAN NOT NULL DEFAULT false,
    "submitKey" UUID NOT NULL,
    "readByShopAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePortalRead" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePortalRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareMessageDigest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "status" "CareEmailStatus" NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "unreadCount" INTEGER NOT NULL,
    "threadCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareMessageDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareMessage_tenantId_subscriptionId_createdAt_idx" ON "CareMessage"("tenantId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "CareMessage_authorUserId_idx" ON "CareMessage"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CareMessage_tenantId_id_key" ON "CareMessage"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareMessage_tenantId_submitKey_key" ON "CareMessage"("tenantId", "submitKey");

-- CreateIndex
CREATE INDEX "CarePortalRead_userId_idx" ON "CarePortalRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePortalRead_tenantId_id_key" ON "CarePortalRead"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePortalRead_tenantId_subscriptionId_userId_key" ON "CarePortalRead"("tenantId", "subscriptionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CareMessageDigest_tenantId_id_key" ON "CareMessageDigest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CareMessageDigest_tenantId_day_key" ON "CareMessageDigest"("tenantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "CarePhoto_tenantId_messageId_key" ON "CarePhoto"("tenantId", "messageId");

-- AddForeignKey
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_tenantId_messageId_fkey" FOREIGN KEY ("tenantId", "messageId") REFERENCES "CareMessage"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_tenantId_subscriptionId_customerId_fkey" FOREIGN KEY ("tenantId", "subscriptionId", "customerId") REFERENCES "CustomerSubscription"("tenantId", "id", "customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalRead" ADD CONSTRAINT "CarePortalRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalRead" ADD CONSTRAINT "CarePortalRead_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "CustomerSubscription"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePortalRead" ADD CONSTRAINT "CarePortalRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareMessageDigest" ADD CONSTRAINT "CareMessageDigest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

-- Testo o foto; il testo al massimo 2000 caratteri; "letto dalla fioreria" solo sui messaggi del
-- cliente. L'autore può mancare: chi ha eliminato il conto ("Cuenta eliminada").
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_values_check" CHECK (
  char_length("body") <= 2000
  AND ("body" <> '' OR "hasPhoto")
  AND ("readByShopAt" IS NULL OR "authorKind" = 'CUSTOMER')
);

-- I messaggi del cliente ancora da leggere: il riquadro, la scheda «Mensajes» e il riassunto.
CREATE INDEX "CareMessage_unread_idx" ON "CareMessage"("tenantId", "subscriptionId")
  WHERE "authorKind" = 'CUSTOMER' AND "readByShopAt" IS NULL;

-- Come le altre email: al massimo 3 tentativi; inviato ⇔ data d'invio; l'errore è un codice.
ALTER TABLE "CareMessageDigest" ADD CONSTRAINT "CareMessageDigest_values_check" CHECK (
  "attempts" BETWEEN 1 AND 3
  AND "status" <> 'PENDING'
  AND (("status" = 'SENT') = ("sentAt" IS NOT NULL))
  AND "unreadCount" >= 0 AND "threadCount" >= 0
  AND ("lastError" IS NULL OR char_length("lastError") BETWEEN 1 AND 60)
);

-- La foto di un messaggio non è di una visita né di una pianta; tutte le altre sì (oggi una foto
-- senza visita né pianta era rifiutata). Il resto della regola resta com'era (ADR-078).
ALTER TABLE "CarePhoto" DROP CONSTRAINT "CarePhoto_values_check";
ALTER TABLE "CarePhoto" ADD CONSTRAINT "CarePhoto_values_check" CHECK (
  "storageKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND "thumbKey" LIKE 'tenants/' || "tenantId"::text || '/care-photos/%'
  AND "width" > 0 AND "height" > 0 AND "sizeBytes" > 0
  AND CASE
    WHEN "messageId" IS NOT NULL THEN "visitId" IS NULL AND "plantId" IS NULL
    ELSE "visitId" IS NOT NULL OR "plantId" IS NOT NULL
  END
  AND (("removedAt" IS NULL) = ("removedById" IS NULL))
  AND ("deletedAt" IS NULL OR "deletedAt" >= "createdAt")
);

-- Ogni tipo di email ha il suo riferimento, e solo quello: il resoconto una visita, l'avviso di un
-- blocco il blocco, l'avviso dei messaggi il giorno. Sostituisce "CareEmail_block_check", che
-- chiedeva un blocco a ogni email diversa dal resoconto.
ALTER TABLE "CareEmail" DROP CONSTRAINT "CareEmail_block_check";
ALTER TABLE "CareEmail" ADD CONSTRAINT "CareEmail_kind_check" CHECK (
  CASE "kind"
    WHEN 'VISIT_REPORT' THEN "visitId" IS NOT NULL AND "blockId" IS NULL AND "noticeDay" IS NULL
    WHEN 'BLOCK_NOTICE' THEN "blockId" IS NOT NULL AND "visitId" IS NULL AND "noticeDay" IS NULL
    WHEN 'MESSAGE_NOTICE' THEN "noticeDay" IS NOT NULL AND "visitId" IS NULL AND "blockId" IS NULL
    ELSE false
  END
);
-- Un avviso dei messaggi per contratto e giorno: la fioreria che scrive tre volte non ne manda tre.
CREATE UNIQUE INDEX "CareEmail_message_notice_key" ON "CareEmail"("tenantId", "subscriptionId", "noticeDay")
  WHERE "noticeDay" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
SELECT app_enable_tenant_rls('"CareMessage"');
SELECT app_enable_tenant_rls('"CarePortalRead"');
SELECT app_enable_tenant_rls('"CareMessageDigest"');

-- Portale: il filo del contratto aperto e il proprio segno di lettura.
SELECT app_enable_portal_read('"CareMessage"', '"subscriptionId" = app_portal_subscription_id()');
SELECT app_enable_portal_read(
  '"CarePortalRead"',
  '"subscriptionId" = app_portal_subscription_id() AND "userId" = app_current_user_id()'
);

-- Portale: la persona inserisce solo i propri messaggi, sul contratto aperto, mentre è attivo o in
-- pausa. Mai come fioreria, mai a nome di un altro, mai già "letto".
CREATE POLICY portal_insert ON "CareMessage" FOR INSERT
  WITH CHECK (
    app_portal_subscription_id() IS NOT NULL
    AND "tenantId" = app_portal_tenant_id()
    AND "subscriptionId" = app_portal_subscription_id()
    AND "customerId" = app_portal_customer_id()
    AND "authorKind" = 'CUSTOMER'
    AND "authorUserId" = app_current_user_id()
    AND "readByShopAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CustomerSubscription" s
      WHERE s.id = app_portal_subscription_id() AND s.status IN ('ACTIVE', 'PAUSED')
    )
  );

-- Portale: la foto solo di un proprio messaggio del contratto aperto (mai di una visita o pianta).
CREATE POLICY portal_insert ON "CarePhoto" FOR INSERT
  WITH CHECK (
    app_portal_subscription_id() IS NOT NULL
    AND "tenantId" = app_portal_tenant_id()
    AND "subscriptionId" = app_portal_subscription_id()
    AND "messageId" IS NOT NULL
    AND "visitId" IS NULL
    AND "plantId" IS NULL
    AND "removedAt" IS NULL
    AND "deletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CareMessage" m
      WHERE m."tenantId" = "CarePhoto"."tenantId"
        AND m.id = "CarePhoto"."messageId"
        AND m."subscriptionId" = app_portal_subscription_id()
        AND m."authorKind" = 'CUSTOMER'
        AND m."authorUserId" = app_current_user_id()
    )
  );

-- -----------------------------------------------------------------------------
-- Funzioni
-- -----------------------------------------------------------------------------

-- "Letto": il segno della persona sul contratto aperto dal portale (persona e contratto solo dal
-- contesto del portale, mai da un argomento). Restituisce l'ora salvata; null fuori dal portale.
CREATE FUNCTION app_portal_mark_read()
RETURNS timestamp
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
    RETURN NULL;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  -- Lo stesso controllo dell'ingresso nel portale: solo un contratto che la persona vede.
  IF NOT EXISTS (
    SELECT 1 FROM app_portal_visible_contracts(person) v
    WHERE v.tenant_id = tenant AND v.subscription_id = sub
  ) THEN
    PERFORM set_config('app.bypass_rls', previous, true);
    RETURN NULL;
  END IF;
  INSERT INTO "CarePortalRead" ("id", "tenantId", "subscriptionId", "userId", "readAt")
  VALUES (gen_random_uuid(), tenant, sub, person, stamp)
  ON CONFLICT ("tenantId", "subscriptionId", "userId") DO UPDATE SET "readAt" = EXCLUDED."readAt";
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN stamp;
END;
$$;

-- "Mi Floral Care" con i messaggi nuovi della fioreria (dopo l'ultima lettura della persona).
-- Cambia il tipo restituito: va ricreata.
DROP FUNCTION app_buyer_care_contracts();
CREATE FUNCTION app_buyer_care_contracts()
RETURNS TABLE (
  tenant_id uuid,
  subscription_id uuid,
  shop_slug text,
  shop_name text,
  shop_timezone text,
  number integer,
  status text,
  read_only boolean,
  can_see_money boolean,
  customer_name text,
  site_label text,
  site_line text,
  end_date date,
  next_visit_date date,
  next_visit_start integer,
  due_minor integer,
  currency text,
  unread_count integer
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
    SELECT v.tenant_id, v.subscription_id, t.slug, t."displayName", t.timezone, s.number,
           s.status::text, v.read_only, v.can_see_money, c."displayName",
           addr.label, addr."addressLine1", s."endDate",
           nv."scheduledDate", nv."startMinutes",
           CASE WHEN v.can_see_money THEN (
             SELECT coalesce(sum(greatest(ch."totalMinor" - ch."paidMinor", 0)), 0)::integer
             FROM "CareCharge" ch
             WHERE ch."tenantId" = v.tenant_id AND ch."subscriptionId" = v.subscription_id
           ) ELSE NULL END,
           s.currency::text,
           (
             SELECT count(*)::integer
             FROM "CareMessage" m
             WHERE m."tenantId" = v.tenant_id AND m."subscriptionId" = v.subscription_id
               AND m."authorKind" = 'SHOP'
               AND m."createdAt" > coalesce((
                 SELECT r."readAt" FROM "CarePortalRead" r
                 WHERE r."tenantId" = v.tenant_id AND r."subscriptionId" = v.subscription_id
                   AND r."userId" = person
               ), '-infinity'::timestamp)
           )
    FROM app_portal_visible_contracts(person) v
    JOIN "Tenant" t ON t.id = v.tenant_id
    JOIN "CustomerSubscription" s ON s."tenantId" = v.tenant_id AND s.id = v.subscription_id
    JOIN "Customer" c ON c."tenantId" = v.tenant_id AND c.id = v.customer_id
    LEFT JOIN "CustomerAddress" addr
      ON addr."tenantId" = s."tenantId" AND addr.id = s."customerAddressId"
    LEFT JOIN LATERAL (
      SELECT cv."scheduledDate", cv."startMinutes"
      FROM "CareVisit" cv
      WHERE cv."tenantId" = s."tenantId" AND cv."subscriptionId" = s.id
        AND cv.status = 'SCHEDULED'
        AND cv."scheduledDate" >= (now() AT TIME ZONE t.timezone)::date
      ORDER BY cv."scheduledDate", cv."startMinutes"
      LIMIT 1
    ) nv ON true
    ORDER BY v.read_only, t."displayName", s.number
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- "Descargar mis datos": i messaggi scritti dalla persona, fra tutte le fiorerie (senza ID).
CREATE FUNCTION app_buyer_care_messages()
RETURNS TABLE (
  shop_name text,
  contract_number integer,
  created_at timestamp,
  body text,
  has_photo boolean
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
    SELECT t."displayName", s.number, m."createdAt", m.body, m."hasPhoto"
    FROM "CareMessage" m
    JOIN "Tenant" t ON t.id = m."tenantId"
    JOIN "CustomerSubscription" s ON s."tenantId" = m."tenantId" AND s.id = m."subscriptionId"
    WHERE m."authorUserId" = person
    ORDER BY m."createdAt", m.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Il lavoro giornaliero: le fiorerie LIVE a cui tocca il riassunto (solo gli ID). Serve un
-- messaggio del cliente non letto arrivato dopo l'ultimo riassunto mandato; oggi (nel fuso della
-- fioreria) nessun riassunto mandato o in corso, oppure uno fallito con tentativi rimasti, oppure
-- uno fermo da più di un'ora (il lavoro lo chiude).
CREATE FUNCTION app_care_message_digests_due(max_rows integer)
RETURNS TABLE (tenant_id uuid)
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
    SELECT t.id
    FROM "Tenant" t
    LEFT JOIN "CareMessageDigest" today
      ON today."tenantId" = t.id AND today.day = (now() AT TIME ZONE t.timezone)::date
    WHERE t.status = 'ACTIVE'
      AND t.mode = 'LIVE'
      AND (
        today.id IS NULL
        OR (today.status = 'FAILED' AND today.attempts < 3)
        OR (today.status = 'SENDING' AND today."updatedAt" < utc_now - interval '60 minutes')
      )
      AND EXISTS (
        SELECT 1 FROM "CareMessage" m
        WHERE m."tenantId" = t.id
          AND m."authorKind" = 'CUSTOMER'
          AND m."readByShopAt" IS NULL
          AND m."createdAt" > coalesce((
            SELECT max(d."sentAt") FROM "CareMessageDigest" d
            WHERE d."tenantId" = t.id AND d.status = 'SENT'
          ), '-infinity'::timestamp)
      )
    ORDER BY t.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
