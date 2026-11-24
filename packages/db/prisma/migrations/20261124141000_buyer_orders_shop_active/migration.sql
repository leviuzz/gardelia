-- "Mis pedidos" e una fioreria in eliminazione (ADR-074): la funzione dice anche se la fioreria è
-- attiva. La lista di chi compra nasconde gli ordini delle fiorerie archiviate (link e tienda non si
-- aprono più); "Descargar mis datos" li tiene finché esistono. Cambia il tipo restituito, quindi si
-- ricrea la funzione (stessa logica di 20261123232000_marketplace_orders più `shop_active`).
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
    SELECT o.id, o."tenantId", t.slug, t."displayName", t.status = 'ACTIVE', o.number,
           o.status::text, o."fulfillmentMode"::text, o."scheduledDate", o."totalMinor",
           o.currency::text, o."createdAt",
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
