-- Floral Care, blocco 6a (ADR-085): le foto dei casi dell'Asistente de plantas si cancellano con le
-- foto delle visite, 30 giorni dopo la fine del contratto (ADR-078). La funzione che sceglie i
-- contratti da ripulire guarda anche i casi con la foto ancora presente (stessa firma: la
-- manutenzione non cambia il modo di chiamarla).
CREATE OR REPLACE FUNCTION app_care_photos_to_purge(retention_days integer, max_rows integer)
RETURNS TABLE (tenant_id uuid, subscription_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    WITH pending AS (
      SELECT p."tenantId" AS tenant, p."subscriptionId" AS sub, p."removedAt" AS removed,
             p."createdAt" AS created
      FROM "CarePhoto" p
      WHERE p."deletedAt" IS NULL
      UNION ALL
      SELECT a."tenantId", a."subscriptionId", NULL::timestamp, a."createdAt"
      FROM "AssistantCase" a
      WHERE a."photoDeletedAt" IS NULL
    )
    SELECT p.tenant, p.sub
    FROM pending p
    JOIN "CustomerSubscription" s ON s."tenantId" = p.tenant AND s.id = p.sub
    JOIN "Tenant" t ON t.id = p.tenant
    WHERE t.status = 'ACTIVE'
      AND (
        p.removed IS NOT NULL
        OR (
          s.status = 'ENDED'
          AND coalesce(
            s."endDate",
            ((s."endedAt" AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)::date
          ) + retention_days <= (now() AT TIME ZONE t.timezone)::date
        )
      )
    GROUP BY p.tenant, p.sub
    ORDER BY min(coalesce(p.removed, s."endedAt", p.created)), p.sub
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;
