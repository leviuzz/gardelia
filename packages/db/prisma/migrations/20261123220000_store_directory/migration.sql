-- Ricerca delle fiorerie per chi compra (marketplace, blocco C3, ADR-066).
-- Funzioni di piattaforma come app_public_store_tenant: SECURITY DEFINER, solo fiorerie attive con
-- la tienda pubblicata, solo i dati che la pagina pubblica mostra già. Niente da scrivere.

-- Elenco delle tiendas pubblicate con dove sono, fin dove consegnano e quanti prodotti mostrano.
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
  online_items integer
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
               AND i.type IN ('BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY'))
    FROM "Tenant" t
    JOIN "OnlineStore" s ON s."tenantId" = t.id
    LEFT JOIN "Location" l ON l."tenantId" = t.id AND l."isPrimary"
    WHERE t.status = 'ACTIVE' AND s."isPublished"
    ORDER BY t."displayName";
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Sedi delle tiendas pubblicate con un place ID di Google e coordinate mancanti o vecchie: la
-- manutenzione giornaliera le richiede a Google (la cache permessa è di 30 giorni, ADR-059), così la
-- ricerca per distanza non si spegne dopo un mese.
CREATE FUNCTION app_store_places_to_refresh(older_than_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, location_id uuid, place_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  cutoff timestamp := (now() AT TIME ZONE 'UTC') - make_interval(days => least(greatest(older_than_days, 1), 29));
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT l."tenantId", l.id, l."placeId"
    FROM "Location" l
    JOIN "Tenant" t ON t.id = l."tenantId"
    JOIN "OnlineStore" s ON s."tenantId" = l."tenantId"
    WHERE l."isPrimary" AND l."placeId" IS NOT NULL
      AND t.status = 'ACTIVE' AND s."isPublished"
      AND (l."coordinatesAt" IS NULL OR l."coordinatesAt" < cutoff)
    ORDER BY l."coordinatesAt" NULLS FIRST
    LIMIT least(greatest(max_rows, 1), 200);
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
