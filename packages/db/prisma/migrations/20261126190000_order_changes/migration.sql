-- Marketplace M3-2 «Cambi da confermare» (ADR-088):
--  - `OrderChangeRequest`: su un ordine online da accettare il fiorista cambia l'ordine e chiede la
--    conferma a chi compra. Una riga per ordine, con l'ordine com'era al primo cambio (`before`) e
--    com'è quando il fiorista chiede (`after`); chi compra risponde alla richiesta che ha visto
--    (`round`). Chi compra la tocca solo dal servizio, con la guardia `buyer_order_guard`.
--  - `OrderMessage`: domande «sì / no» della fioreria e risposte di chi compra (una per domanda,
--    dello stesso ordine: FK composita con `orderId`).
--  - La scadenza conta dall'invio, dall'ultima richiesta o dall'ultima risposta (la più recente),
--    come `pendingOrderDeadline` del dominio; il promemoria è uno per scadenza.

-- AlterTable
ALTER TABLE "OrderMessage" ADD COLUMN     "answer" TEXT,
ADD COLUMN     "answersMessageId" UUID,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'MESSAGE',
ADD COLUMN     "questionContext" JSONB;

-- CreateTable
CREATE TABLE "OrderChangeRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EDITING',
    "before" JSONB NOT NULL,
    "after" JSONB,
    "round" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "askedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderChangeRequest_tenantId_id_key" ON "OrderChangeRequest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderChangeRequest_tenantId_orderId_key" ON "OrderChangeRequest"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMessage_tenantId_orderId_id_key" ON "OrderMessage"("tenantId", "orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMessage_tenantId_orderId_answersMessageId_key" ON "OrderMessage"("tenantId", "orderId", "answersMessageId");

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_tenantId_orderId_answersMessageId_fkey" FOREIGN KEY ("tenantId", "orderId", "answersMessageId") REFERENCES "OrderMessage"("tenantId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChangeRequest" ADD CONSTRAINT "OrderChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChangeRequest" ADD CONSTRAINT "OrderChangeRequest_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Vincoli
-- -----------------------------------------------------------------------------

-- Il messaggio ha testo o foto; la domanda «sì / no» ha sempre il testo (la foto è facoltativa) e la
-- scrive la fioreria; la risposta ha solo `answer` (niente testo né foto), la scrive chi compra e
-- punta alla domanda. Il resto come prima (lunghezza, «letto dalla fioreria», file della foto).
ALTER TABLE "OrderMessage" DROP CONSTRAINT "OrderMessage_values_check";
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_values_check" CHECK (
  char_length("body") <= 2000
  AND "kind" IN ('MESSAGE', 'QUESTION', 'ANSWER')
  AND (
    (
      "kind" = 'MESSAGE'
      AND ("body" <> '' OR "photoKey" IS NOT NULL)
      AND "answer" IS NULL AND "answersMessageId" IS NULL AND "questionContext" IS NULL
    )
    OR (
      "kind" = 'QUESTION'
      AND "authorKind" = 'SHOP'
      AND "body" <> ''
      AND "answer" IS NULL AND "answersMessageId" IS NULL
      AND ("questionContext" IS NULL OR jsonb_typeof("questionContext") = 'object')
    )
    OR (
      "kind" = 'ANSWER'
      AND "authorKind" = 'BUYER'
      AND "body" = '' AND "photoKey" IS NULL
      AND "answer" IN ('YES', 'NO') AND "answersMessageId" IS NOT NULL
      AND "questionContext" IS NULL
    )
  )
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

-- Stati di `ORDER_CHANGE_STATUSES`; le fotografie sono oggetti JSON; una richiesta fatta ha la
-- fotografia di dopo, la data e il numero; una risposta ha la sua data; testi entro i limiti del
-- dominio (`ORDER_CHANGE_LIMITS`).
ALTER TABLE "OrderChangeRequest" ADD CONSTRAINT "OrderChangeRequest_values_check" CHECK (
  "status" IN ('EDITING', 'ASKED', 'CONFIRMED', 'DECLINED')
  AND jsonb_typeof("before") = 'object'
  AND ("after" IS NULL OR jsonb_typeof("after") = 'object')
  AND "round" >= 0
  AND ("status" = 'EDITING' OR ("after" IS NOT NULL AND "askedAt" IS NOT NULL AND "round" >= 1))
  AND ("status" NOT IN ('CONFIRMED', 'DECLINED') OR "answeredAt" IS NOT NULL)
  AND ("message" IS NULL OR char_length("message") BETWEEN 1 AND 500)
  AND ("declineReason" IS NULL OR char_length("declineReason") BETWEEN 1 AND 300)
);

-- -----------------------------------------------------------------------------
-- RLS per fioreria e guardia di chi compra
-- -----------------------------------------------------------------------------

SELECT app_enable_tenant_rls('"OrderChangeRequest"');
SELECT app_enable_buyer_order_guard('"OrderChangeRequest"', 'orderId');

-- -----------------------------------------------------------------------------
-- Scadenza: la stessa regola del dominio (`pendingOrderDeadline`, `pendingOrderClockStart`)
-- -----------------------------------------------------------------------------

-- Ordini online che nessuno ha accettato in tempo: `accept_days` giorni dopo l'invio, l'ultima
-- richiesta di conferma o l'ultima risposta di chi compra (la più recente), ma non oltre la fine del
-- giorno di consegna nel fuso della fioreria. Stessa firma di prima.
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
    LEFT JOIN "OrderChangeRequest" c ON c."tenantId" = o."tenantId" AND c."orderId" = o.id
    WHERE o.status = 'PENDING_ACCEPTANCE'
      AND LEAST(
        GREATEST(o."createdAt", c."askedAt", c."answeredAt") + make_interval(days => accept_days),
        CASE WHEN o."scheduledDate" IS NULL THEN NULL
             ELSE ((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone) AT TIME ZONE 'UTC'
        END
      ) <= (now() AT TIME ZONE 'UTC')
    ORDER BY o."createdAt"
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Il promemoria della scadenza: ordini online ancora da accettare di fiorerie attive, la cui
-- scadenza arriva entro `horizon_hours`, a cui non è ancora partito un promemoria dopo l'inizio del
-- conto: una richiesta o una risposta fanno ripartire il conto e il promemoria. A chi va (fioreria
-- o chi compra) lo decide il servizio. Stessa firma di prima.
CREATE OR REPLACE FUNCTION app_pending_orders_to_remind(
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
      SELECT o."tenantId" AS tenant, o.id,
             GREATEST(o."createdAt", c."askedAt", c."answeredAt") AS clock_start,
             LEAST(
               GREATEST(o."createdAt", c."askedAt", c."answeredAt")
                 + make_interval(days => accept_days),
               CASE WHEN o."scheduledDate" IS NULL THEN NULL
                    ELSE ((o."scheduledDate" + 1)::timestamp AT TIME ZONE t.timezone)
                         AT TIME ZONE 'UTC'
               END
             ) AS deadline
      FROM "Order" o
      JOIN "Tenant" t ON t.id = o."tenantId"
      LEFT JOIN "OrderChangeRequest" c ON c."tenantId" = o."tenantId" AND c."orderId" = o.id
      WHERE o.status = 'PENDING_ACCEPTANCE' AND t.status = 'ACTIVE'
    ) d
    WHERE d.deadline > now_utc
      AND d.deadline <= now_utc + make_interval(hours => horizon_hours)
      AND NOT EXISTS (
        SELECT 1 FROM "OrderNotice" n
        WHERE n."tenantId" = d.tenant AND n."orderId" = d.id AND n.kind = 'EXPIRY_REMINDER'
          AND n."sentAt" >= d.clock_start
      )
    ORDER BY d.deadline, d.id
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- -----------------------------------------------------------------------------
-- Funzioni per chi compra (l'utente SOLO dal contesto, mai da un parametro)
-- -----------------------------------------------------------------------------

-- "I miei ordini" con i messaggi nuovi e i cambi da confermare. Cambia il tipo restituito, quindi
-- si ricrea (stessa logica di 20261126150000_order_messages).
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
  new_messages integer,
  changes_to_confirm boolean
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
               )),
           (o.status = 'PENDING_ACCEPTANCE' AND EXISTS (
             SELECT 1 FROM "OrderChangeRequest" c
             WHERE c."tenantId" = o."tenantId" AND c."orderId" = o.id AND c.status = 'ASKED'
           ))
    FROM "Order" o
    JOIN "Tenant" t ON t.id = o."tenantId"
    WHERE o."buyerUserId" = buyer
    ORDER BY o."createdAt" DESC
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Scarica i miei dati»: i messaggi scritti dalla persona sugli ordini, in tutte le fiorerie, con il
-- tipo (le risposte alle domande «sì / no» hanno `answer` e niente testo). Cambia il tipo
-- restituito, quindi si ricrea.
DROP FUNCTION app_buyer_order_messages();

CREATE FUNCTION app_buyer_order_messages()
RETURNS TABLE (
  shop_name text,
  order_number integer,
  created_at timestamp,
  body text,
  has_photo boolean,
  kind text,
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
    SELECT t."displayName", o.number, m."createdAt", m.body, m."photoKey" IS NOT NULL,
           m.kind, m.answer
    FROM "OrderMessage" m
    JOIN "Tenant" t ON t.id = m."tenantId"
    JOIN "Order" o ON o."tenantId" = m."tenantId" AND o.id = m."orderId"
    WHERE m."authorUserId" = person
    ORDER BY m."createdAt", m.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- «Scarica i miei dati»: le risposte della persona ai cambi proposti dalle fiorerie (l'ultima per
-- ordine: «Confirmar» o «No, gracias» con il motivo), senza ID interni.
CREATE FUNCTION app_buyer_order_change_answers()
RETURNS TABLE (
  shop_name text,
  order_number integer,
  answered_at timestamp,
  status text,
  decline_reason text
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
    SELECT t."displayName", o.number, c."answeredAt", c.status, c."declineReason"
    FROM "OrderChangeRequest" c
    JOIN "Tenant" t ON t.id = c."tenantId"
    JOIN "Order" o ON o."tenantId" = c."tenantId" AND o.id = c."orderId"
    WHERE o."buyerUserId" = person
      AND c."answeredAt" IS NOT NULL
      AND c.status IN ('CONFIRMED', 'DECLINED')
    ORDER BY c."answeredAt", c.id
    LIMIT 5000;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
