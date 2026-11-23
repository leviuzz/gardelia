-- Ordine del cliente online (marketplace, blocco C4, ADR-067).
-- AlterTable
ALTER TABLE "OnlineStore" ADD COLUMN     "minLeadDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ordersEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "buyerNotes" TEXT,
ADD COLUMN     "buyerUserId" UUID,
ADD COLUMN     "placedOnline" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Order_buyerUserId_idx" ON "Order"("buyerUserId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Integrità e lettura per chi compra (non esprimibili in Prisma)
-- =============================================================================

-- Anticipo minimo fra 0 (anche oggi) e 14 giorni.
ALTER TABLE "OnlineStore"
  ADD CONSTRAINT "OnlineStore_minLeadDays_check" CHECK ("minLeadDays" BETWEEN 0 AND 14);

-- Chi compra c'è solo negli ordini fatti online.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_buyer_online_check" CHECK ("buyerUserId" IS NULL OR "placedOnline");

-- I pedidos di chi ha fatto l'accesso, in tutte le fiorerie, con i soli dati che vede già nel suo
-- link di tracciamento. L'utente viene SOLO dal contesto (app.user_id, withUserContext), mai da un
-- parametro: nessuno può chiedere gli ordini di un altro.
CREATE FUNCTION app_buyer_orders()
RETURNS TABLE (
  order_id uuid,
  tenant_id uuid,
  shop_slug text,
  shop_name text,
  number integer,
  status text,
  fulfillment_mode text,
  scheduled_date date,
  total_minor integer,
  currency text,
  created_at timestamp,
  link_id uuid
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
    SELECT o.id, o."tenantId", t.slug, t."displayName", o.number, o.status::text,
           o."fulfillmentMode"::text, o."scheduledDate", o."totalMinor", o.currency::text,
           o."createdAt",
           (SELECT l.id FROM "PublicLink" l
             WHERE l."tenantId" = o."tenantId" AND l."orderId" = o.id AND l.kind = 'ORDER'
               AND l."revokedAt" IS NULL AND l."expiresAt" > (now() AT TIME ZONE 'UTC')
             ORDER BY l."createdAt" DESC LIMIT 1)
    FROM "Order" o
    JOIN "Tenant" t ON t.id = o."tenantId"
    WHERE o."buyerUserId" = buyer
    ORDER BY o."createdAt" DESC
    LIMIT 100;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Ordini online che nessuno ha accettato in tempo (manutenzione giornaliera): fermi da più di
-- `accept_days` giorni o con il giorno di consegna già passato nel fuso della fioreria. Solo gli ID:
-- l'annullamento (stato, cronologia, registro, email) lo fa il servizio nel contesto di ogni
-- fioreria, con la RLS attiva, ricontrollando le stesse condizioni.
CREATE FUNCTION app_pending_orders_to_expire(accept_days integer, max_rows integer)
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
      AND (
        o."createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => accept_days)
        OR o."scheduledDate" < (now() AT TIME ZONE t.timezone)::date
      )
    ORDER BY o."createdAt"
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
