-- Vetrina, blocco M1-2 «Strumenti e visibilità» (ADR-087): occasioni dei prodotti, schede della
-- ricerca delle fiorerie con i dati che la vetrina mostra già, e l'elenco per la sitemap.xml.
-- Nessuna tabella nuova: le colonne nuove stanno in tabelle che hanno già la loro RLS.

-- Occasioni scelte dal fiorista: identificativi in inglese, solo i 9 previsti (dominio
-- `CATALOG_OCCASIONS`); i doppioni li toglie il servizio.
ALTER TABLE "CatalogItem" ADD COLUMN "occasions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_occasions_check" CHECK (
    "occasions" <@ ARRAY[
      'BIRTHDAY', 'ANNIVERSARY', 'LOVE', 'MOTHERS_DAY', 'SYMPATHY',
      'NEW_BABY', 'GRADUATION', 'THANK_YOU', 'GET_WELL'
    ]::TEXT[]
    AND cardinality("occasions") <= 9
  );

-- Schede della ricerca (`/buscar`): oltre a prima, ordini online, anticipo, giorni chiusi, fuso
-- orario e costo di consegna (per «Entrega desde mañana» e il costo) e le occasioni dei prodotti
-- online. Sono tutti dati che la pagina pubblica della fioreria mostra già. Stesse regole di prima:
-- solo fiorerie attive con la tienda pubblicata, bypass della RLS solo dentro la funzione.
DROP FUNCTION app_public_store_directory();
CREATE FUNCTION app_public_store_directory()
RETURNS TABLE (
  slug text,
  name text,
  neighborhood text,
  city text,
  region text,
  latitude double precision,
  longitude double precision,
  coordinates_at timestamp,
  delivery_radius_km integer,
  logo_id uuid,
  online_items integer,
  orders_enabled boolean,
  min_lead_days integer,
  closed_weekdays integer[],
  timezone text,
  currency text,
  default_fee_minor integer,
  fee_tiers jsonb,
  occasions text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t.slug, t."displayName", l.neighborhood, l.city, l.region,
           l.latitude, l.longitude, l."coordinatesAt", l."deliveryRadiusKm",
           s."logoId",
           (SELECT count(*)::integer FROM "CatalogItem" i
             WHERE i."tenantId" = t.id AND i."isOnline" AND i.status = 'ACTIVE'
               AND i.type IN ('BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY')),
           s."ordersEnabled", s."minLeadDays", t."deliveryClosedWeekdays", t.timezone,
           t.currency::text, t."defaultDeliveryFeeMinor",
           (SELECT coalesce(
                     jsonb_agg(jsonb_build_object('maxMeters', f."maxMeters", 'feeMinor', f."feeMinor")
                               ORDER BY f."maxMeters"),
                     '[]'::jsonb)
              FROM "DeliveryFeeTier" f WHERE f."tenantId" = t.id),
           (SELECT coalesce(array_agg(DISTINCT o ORDER BY o), ARRAY[]::text[])
              FROM "CatalogItem" i, unnest(i."occasions") AS o
             WHERE i."tenantId" = t.id AND i."isOnline" AND i.status = 'ACTIVE'
               AND i.type IN ('BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY'))
    FROM "Tenant" t
    JOIN "OnlineStore" s ON s."tenantId" = t.id
    LEFT JOIN "Location" l ON l."tenantId" = t.id AND l."isPrimary"
    WHERE t.status = 'ACTIVE' AND s."isPublished"
    ORDER BY t."displayName";
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Elenco per la sitemap.xml (si usa solo con `PUBLIC_INDEXING` acceso): le vetrine pubblicate e i
-- loro prodotti online e attivi, al massimo `max_rows` righe (le sitemap ne accettano 50.000).
-- `item_id` è null per la vetrina stessa.
CREATE FUNCTION app_public_sitemap(max_rows integer)
RETURNS TABLE (slug text, item_id uuid, updated_at timestamp)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT entries.slug, entries.item_id, entries.updated_at
    FROM (
      SELECT t.slug, NULL::uuid AS item_id, s."updatedAt" AS updated_at, 0 AS kind
        FROM "Tenant" t
        JOIN "OnlineStore" s ON s."tenantId" = t.id
       WHERE t.status = 'ACTIVE' AND s."isPublished"
      UNION ALL
      SELECT t.slug, i.id, i."updatedAt", 1
        FROM "CatalogItem" i
        JOIN "Tenant" t ON t.id = i."tenantId"
        JOIN "OnlineStore" s ON s."tenantId" = t.id
       WHERE t.status = 'ACTIVE' AND s."isPublished"
         AND i."isOnline" AND i.status = 'ACTIVE'
         AND i.type IN ('BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY')
    ) AS entries
    ORDER BY entries.kind, entries.slug, entries.item_id
    LIMIT greatest(least(max_rows, 50000), 0);
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
