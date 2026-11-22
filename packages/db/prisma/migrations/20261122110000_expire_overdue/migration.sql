-- Fase 0 (scadenze): le letture non modificano più i dati. Un lavoro programmato (cron giornaliero
-- su Vercel, ciclo nel processo altrove) porta a EXPIRED:
--   - i preventivi inviati oltre la validità, nel calendario della fioreria (il suo fuso orario);
--   - gli inviti ancora in attesa oltre la scadenza.
-- Funzione SECURITY DEFINER come app_claim_ai_job: il lavoro riguarda tutte le fiorerie e il web
-- non usa un contesto di sistema. Le pagine mostrano già lo stato effettivo (calcolato in lettura
-- con le stesse regole), quindi un ritardo del lavoro non cambia ciò che vede l'utente.
CREATE FUNCTION app_expire_overdue()
RETURNS TABLE (quotes_expired integer, invitations_expired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  utc_now timestamp := now() AT TIME ZONE 'UTC';
  quotes integer;
  invitations integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  -- Stessa regola di effectiveQuoteStatus (packages/domain): scaduto dal giorno DOPO validUntil.
  UPDATE "Quote" AS q
  SET status = 'EXPIRED', "statusChangedAt" = utc_now, "updatedAt" = utc_now
  FROM "Tenant" AS t
  WHERE q."tenantId" = t.id
    AND q.status = 'SENT'
    AND q."validUntil" IS NOT NULL
    AND q."validUntil" < (now() AT TIME ZONE t.timezone)::date;
  GET DIAGNOSTICS quotes = ROW_COUNT;

  UPDATE "Invitation"
  SET status = 'EXPIRED', "updatedAt" = utc_now
  WHERE status = 'PENDING' AND "expiresAt" < utc_now;
  GET DIAGNOSTICS invitations = ROW_COUNT;

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN QUERY SELECT quotes, invitations;
END;
$$;
