-- Filtro facoltativo per tenant nel prelievo dei job (test deterministici e, in futuro,
-- worker dedicati). In produzione il worker passa NULL: tutti i tenant, in ordine.
DROP FUNCTION IF EXISTS app_claim_ai_job(integer);

CREATE FUNCTION app_claim_ai_job(lease_seconds integer, only_tenant uuid DEFAULT NULL)
RETURNS TABLE (job_id uuid, tenant_id uuid, requested_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  utc_now timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Lease scaduto e tentativi esauriti: il job fallisce (non consuma crediti).
  UPDATE "AiJob"
  SET status = 'FAILED', "errorCode" = 'lease_expired', "finishedAt" = utc_now,
      "lockedUntil" = NULL, "usageUnits" = 0, "updatedAt" = utc_now
  WHERE status = 'RUNNING' AND "lockedUntil" < utc_now AND attempts >= "maxAttempts"
    AND (only_tenant IS NULL OR "tenantId" = only_tenant);

  RETURN QUERY
    UPDATE "AiJob" AS j
    SET status = 'RUNNING',
        attempts = j.attempts + 1,
        "startedAt" = utc_now,
        "lockedUntil" = utc_now + make_interval(secs => lease_seconds),
        "updatedAt" = utc_now
    WHERE j.id = (
      SELECT c.id
      FROM "AiJob" AS c
      WHERE c.attempts < c."maxAttempts"
        AND (only_tenant IS NULL OR c."tenantId" = only_tenant)
        AND (
          (c.status = 'QUEUED' AND c."runAfter" <= utc_now)
          OR (c.status = 'RUNNING' AND c."lockedUntil" < utc_now)
        )
      ORDER BY c."runAfter", c."createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j."tenantId", j."requestedById";

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN;
END
$$;
