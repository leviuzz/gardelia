-- Bozze di import di clienti dimenticate (ADR-070): dopo un giorno si chiudono e il testo del file
-- (dati personali dei clienti) si cancella, in tutte le fiorerie. La chiama la manutenzione
-- giornaliera; SECURITY DEFINER come app_purge_place_coordinates: il web non usa un contesto di
-- sistema.
CREATE FUNCTION app_close_stale_customer_imports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  -- Fisso a un giorno, come le bozze che una nuova bozza chiude (customer-import.ts).
  cutoff timestamp := (now() AT TIME ZONE 'UTC') - interval '1 day';
  closed integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "CustomerImport"
  SET status = 'CANCELLED',
      content = '',
      "completedAt" = now() AT TIME ZONE 'UTC',
      "updatedAt" = now() AT TIME ZONE 'UTC'
  WHERE status = 'DRAFT' AND "createdAt" < cutoff;
  GET DIAGNOSTICS closed = ROW_COUNT;

  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN closed;
END;
$$;
