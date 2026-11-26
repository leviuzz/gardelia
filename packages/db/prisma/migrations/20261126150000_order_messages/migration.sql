-- Marketplace M3-1 (ADR-088): messaggi fra chi compra e la fioreria su un ordine online, segno di
-- lettura di chi compra, registro delle email automatiche dell'ordine.
--  - La foto di un messaggio sta nella sua riga: le foto dell'ordine (`OrderPhoto`) sono la prova di
--    consegna e si vedono dal link di stato, queste no. Si cancella 30 giorni dopo la chiusura
--    dell'ordine (o subito se la fioreria la toglie); il testo resta.
--  - Chi compra scrive nel contesto della fioreria (come «Annulla», ADR-072), dopo che il servizio
--    ha controllato che l'ordine è suo. In più il servizio imposta `app.buyer_order_id` e le policy
--    RESTRICTIVE `buyer_order_guard` lasciano toccare solo quell'ordine; per la fioreria (variabile
--    vuota) non cambia niente.
--  - Le funzioni della scadenza ripetono la regola del dominio `pendingOrderDeadline`.

-- CreateEnum
CREATE TYPE "OrderMessageAuthor" AS ENUM ('BUYER', 'SHOP');

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorKind" "OrderMessageAuthor" NOT NULL,
    "authorUserId" UUID,
    "body" TEXT NOT NULL DEFAULT '',
    "photoKey" TEXT,
    "photoThumbKey" TEXT,
    "photoWidth" INTEGER,
    "photoHeight" INTEGER,
    "photoRemovedAt" TIMESTAMP(3),
    "photoDeletedAt" TIMESTAMP(3),
    "submitKey" UUID NOT NULL,
    "readByShopAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderBuyerRead" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBuyerRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderNotice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderMessage_tenantId_orderId_createdAt_idx" ON "OrderMessage"("tenantId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderMessage_authorUserId_idx" ON "OrderMessage"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMessage_tenantId_id_key" ON "OrderMessage"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMessage_tenantId_submitKey_key" ON "OrderMessage"("tenantId", "submitKey");

-- CreateIndex
CREATE INDEX "OrderBuyerRead_userId_idx" ON "OrderBuyerRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBuyerRead_tenantId_id_key" ON "OrderBuyerRead"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBuyerRead_tenantId_orderId_userId_key" ON "OrderBuyerRead"("tenantId", "orderId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderNotice_tenantId_id_key" ON "OrderNotice"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderNotice_tenantId_orderId_kind_key" ON "OrderNotice"("tenantId", "orderId", "kind");

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBuyerRead" ADD CONSTRAINT "OrderBuyerRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBuyerRead" ADD CONSTRAINT "OrderBuyerRead_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBuyerRead" ADD CONSTRAINT "OrderBuyerRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNotice" ADD CONSTRAINT "OrderNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNotice" ADD CONSTRAINT "OrderNotice_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Vincoli e indici
-- -----------------------------------------------------------------------------

-- Testo o foto; il testo al massimo 2000 caratteri; "letto dalla fioreria" solo sui messaggi di chi
-- compra. La foto ha i due file (sotto la cartella della fioreria) e le misure, o niente; le chiavi
-- restano anche dopo la cancellazione dei file, così un messaggio di sola foto resta valido.
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_values_check" CHECK (
  char_length("body") <= 2000
  AND ("body" <> '' OR "photoKey" IS NOT NULL)
  AND ("readByShopAt" IS NULL OR "authorKind" = 'BUYER')
  AND (("photoKey" IS NULL) = ("photoThumbKey" IS NULL))
  AND (("photoKey" IS NULL) = ("photoWidth" IS NULL))
  AND (("photoKey" IS NULL) = ("photoHeight" IS NULL))
  AND (
    "photoKey" IS NULL
    OR (
      "photoKey" LIKE 'tenants/' || "tenantId"::text || '/order-messages/%'
      AND "photoThumbKey" LIKE 'tenants/' || "tenantId"::text || '/order-messages/%'
      AND "photoWidth" > 0 AND "photoHeight" > 0
    )
  )
  AND ("photoRemovedAt" IS NULL OR "photoKey" IS NOT NULL)
  AND ("photoDeletedAt" IS NULL OR "photoKey" IS NOT NULL)
);

-- I messaggi di chi compra ancora da leggere: «Da gestire», il filtro e le righe degli ordini.
CREATE INDEX "OrderMessage_unread_idx" ON "OrderMessage"("tenantId", "orderId")
  WHERE "authorKind" = 'BUYER' AND "readByShopAt" IS NULL;

-- Le foto ancora da cancellare: il lavoro giornaliero.
CREATE INDEX "OrderMessage_photo_pending_idx" ON "OrderMessage"("tenantId", "orderId")
  WHERE "photoKey" IS NOT NULL AND "photoDeletedAt" IS NULL;

-- I tipi delle email automatiche (`ORDER_NOTICE_KINDS` nel dominio).
ALTER TABLE "OrderNotice" ADD CONSTRAINT "OrderNotice_kind_check" CHECK (
  "kind" IN (
    'STEP_IN_PREPARATION',
    'STEP_READY_PICKUP',
    'STEP_OUT_FOR_DELIVERY',
    'STEP_DELIVERED',
    'EXPIRY_REMINDER',
    'MESSAGE_TO_BUYER',
    'MESSAGE_TO_SHOP'
  )
);

-- -----------------------------------------------------------------------------
-- RLS per fioreria
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"OrderMessage"');
SELECT app_enable_tenant_rls('"OrderBuyerRead"');
SELECT app_enable_tenant_rls('"OrderNotice"');

-- -----------------------------------------------------------------------------
-- Guardia di chi compra: con `app.buyer_order_id` impostato (solo dal servizio, dentro la
-- transazione) le tabelle dell'ordine danno e accettano solo le righe di quell'ordine.
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_buyer_order_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.buyer_order_id', true), '')::uuid $$;

CREATE FUNCTION app_enable_buyer_order_guard(target regclass, order_column text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS buyer_order_guard ON %s', target);
  EXECUTE format(
    'CREATE POLICY buyer_order_guard ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_buyer_order_id() IS NULL OR %I = app_buyer_order_id()) '
    'WITH CHECK (app_buyer_order_id() IS NULL OR %I = app_buyer_order_id())',
    target, order_column, order_column
  );
END
$$;

SELECT app_enable_buyer_order_guard('"Order"', 'id');
SELECT app_enable_buyer_order_guard('"OrderLine"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderPayment"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderStatusEvent"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderPhoto"', 'orderId');
SELECT app_enable_buyer_order_guard('"PublicLink"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderMessage"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderBuyerRead"', 'orderId');
SELECT app_enable_buyer_order_guard('"OrderNotice"', 'orderId');

-- -----------------------------------------------------------------------------
-- Funzioni per chi compra (l'utente SOLO dal contesto, mai da un parametro)
-- -----------------------------------------------------------------------------

-- La fioreria di un ordine online, solo se l'ha fatto chi ha l'accesso: da qui il servizio apre il
-- contesto della fioreria. Nessun tetto di ordini (`app_buyer_orders` ne dà al massimo 100).
CREATE FUNCTION app_buyer_order_shop(p_order uuid)
RETURNS TABLE (
  tenant_id uuid,
  shop_slug text,
  shop_name text,
  shop_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  buyer uuid := app_current_user_id();
BEGIN
  IF buyer IS NULL OR p_order IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT o."tenantId", t.slug, t."displayName", t.status = 'ACTIVE'
    FROM "Order" o
    JOIN "Tenant" t ON t.id = o."tenantId"
    WHERE o.id = p_order AND o."buyerUserId" = buyer AND o."placedOnline";
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- "I miei ordini" con i messaggi nuovi della fioreria (dopo l'ultima lettura della persona). Cambia
-- il tipo restituito, quindi si ricrea (stessa logica di 20261124141000_buyer_orders_shop_active).
DROP FUNCTION app_buyer_orders();

CREATE FUNCTION app_buyer_orders()
RETURNS TABLE (
  order_id uuid,
  tenant_id uuid,
  shop_slug text,
  shop_name text,
  shop_active boolean,
  number integer,
  status text,
  fulfillment_mode text,
  scheduled_date date,
  total_minor integer,
  currency text,
  created_at timestamp,
  link_id uuid,
  new_messages integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  buyer uuid := app_current_user_id();
BEGIN
  IF buyer IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT o.id, o."tenantId", t.slug, t."displayName", t.status = 'ACTIVE', o.number,
           o.status::text, o."fulfillmentMode"::text, o."scheduledDate", o."totalMinor",
           o.currency::text, o."createdAt",
           (SELECT l.id FROM "PublicLink" l
             WHERE l."tenantId" = o."tenantId" AND l."orderId" = o.id AND l.kind = 'ORDER'
               AND l."revokedAt" IS NULL AND l."expiresAt" > (now() AT TIME ZONE 'UTC')
             ORDER BY l."createdAt" DESC LIMIT 1),
           (SELECT count(*)::integer FROM "OrderMessage" m
             WHERE m."tenantId" = o."tenantId" AND m."orderId" = o.id AND m."authorKind" = 'SHOP'
               AND m."createdAt" > coalesce(
                 (SELECT r."readAt" FROM "OrderBuyerRead" r
                   WHERE r."tenantId" = o."tenantId" AND r."orderId" = o.id AND r."userId" = buyer),
                 '-infinity'::timestamp
               ))
    FROM "Order" o
    JOIN "Tenant" t ON t.id = o."tenantId"
    WHERE o."buyerUserId" = buyer
    ORDER BY o."createdAt" DESC
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Scarica i miei dati»: i messaggi scritti dalla persona sugli ordini, in tutte le fiorerie, senza
-- ID interni.
CREATE FUNCTION app_buyer_order_messages()
RETURNS TABLE (
  shop_name text,
  order_number integer,
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
    SELECT t."displayName", o.number, m."createdAt", m.body, m."photoKey" IS NOT NULL
    FROM "OrderMessage" m
    JOIN "Tenant" t ON t.id = m."tenantId"
    JOIN "Order" o ON o."tenantId" = m."tenantId" AND o.id = m."orderId"
    WHERE m."authorUserId" = person
    ORDER BY m."createdAt", m.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- -----------------------------------------------------------------------------
-- Lavoro giornaliero (solo ID: il resto lo fa il servizio nel contesto di ogni fioreria)
-- -----------------------------------------------------------------------------

-- Le foto dei messaggi da cancellare: tolte dalla fioreria, oppure di un ordine chiuso da almeno
-- `retention_days` giorni, oppure di un ordine rimasto aperto `retention_days` giorni dopo la fine
-- del suo giorno di consegna (regola del dominio `orderPhotosPurgeAfter`).
CREATE FUNCTION app_order_message_photos_to_purge(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, message_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  now_utc timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT m."tenantId", m.id
    FROM "OrderMessage" m
    JOIN "Order" o ON o."tenantId" = m."tenantId" AND o.id = m."orderId"
    JOIN "Tenant" t ON t.id = m."tenantId"
    WHERE m."photoKey" IS NOT NULL
      AND m."photoDeletedAt" IS NULL
      AND (
        m."photoRemovedAt" IS NOT NULL
        OR (
          o.status IN ('DELIVERED', 'PICKED_UP', 'CANCELLED')
          AND o."statusChangedAt" + make_interval(days => retention_days) <= now_utc
        )
        OR (
          o.status NOT IN ('DELIVERED', 'PICKED_UP', 'CANCELLED')
          AND o."scheduledDate" IS NOT NULL
          AND (((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone) AT TIME ZONE 'UTC')
            + make_interval(days => retention_days) <= now_utc
        )
      )
    ORDER BY m."createdAt", m.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Ordini online che nessuno ha accettato in tempo: la scadenza è `accept_days` giorni dopo l'invio,
-- ma non oltre la fine del giorno di consegna nel fuso della fioreria (regola del dominio
-- `pendingOrderDeadline`). Stessa firma di prima: la manutenzione non cambia il modo di chiamarla.
CREATE OR REPLACE FUNCTION app_pending_orders_to_expire(accept_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT o."tenantId", o.id
    FROM "Order" o
    JOIN "Tenant" t ON t.id = o."tenantId"
    WHERE o.status = 'PENDING_ACCEPTANCE'
      AND LEAST(
        o."createdAt" + make_interval(days => accept_days),
        CASE WHEN o."scheduledDate" IS NULL THEN NULL
             ELSE ((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone) AT TIME ZONE 'UTC'
        END
      ) <= (now() AT TIME ZONE 'UTC')
    ORDER BY o."createdAt"
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Il promemoria alla fioreria: ordini online ancora da accettare la cui scadenza arriva entro
-- `horizon_hours` (prima del giro dopo), di fiorerie attive, a cui il promemoria non è ancora
-- partito.
CREATE FUNCTION app_pending_orders_to_remind(
  accept_days integer,
  horizon_hours integer,
  max_rows integer
)
RETURNS TABLE (tenant_id uuid, order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  now_utc timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT d.tenant, d.id
    FROM (
      SELECT o."tenantId" AS tenant, o.id, o."createdAt" AS created,
             LEAST(
               o."createdAt" + make_interval(days => accept_days),
               CASE WHEN o."scheduledDate" IS NULL THEN NULL
                    ELSE ((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone)
                         AT TIME ZONE 'UTC'
               END
             ) AS deadline
      FROM "Order" o
      JOIN "Tenant" t ON t.id = o."tenantId"
      WHERE o.status = 'PENDING_ACCEPTANCE' AND t.status = 'ACTIVE'
    ) d
    WHERE d.deadline > now_utc
      AND d.deadline <= now_utc + make_interval(hours => horizon_hours)
      AND NOT EXISTS (
        SELECT 1 FROM "OrderNotice" n
        WHERE n."tenantId" = d.tenant AND n."orderId" = d.id AND n.kind = 'EXPIRY_REMINDER'
      )
    ORDER BY d.deadline, d.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
