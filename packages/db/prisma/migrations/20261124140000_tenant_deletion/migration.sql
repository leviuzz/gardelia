-- "Eliminar florería" (ADR-074): il titolare chiede l'eliminazione, la fioreria diventa ARCHIVED
-- (sparisce per tutti) e la manutenzione giornaliera la cancella davvero dopo 30 giorni, con tutti i
-- suoi dati (le tabelle della fioreria la seguono in cascata). Fino ad allora il titolare la
-- recupera.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedById" UUID;

-- I tre campi vanno insieme; una fioreria in eliminazione è sempre archiviata.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_deletion_check" CHECK (
  ("deletionRequestedAt" IS NULL) = ("deleteAfter" IS NULL)
  AND ("deletionRequestedAt" IS NULL) = ("deletionRequestedById" IS NULL)
  AND ("deleteAfter" IS NULL OR (status = 'ARCHIVED' AND "deleteAfter" > "deletionRequestedAt"))
);

-- Solo le fiorerie in eliminazione, in ordine di scadenza (la manutenzione le cerca così).
CREATE INDEX "Tenant_deleteAfter_idx" ON "Tenant" ("deleteAfter") WHERE "deleteAfter" IS NOT NULL;

-- Fiorerie da cancellare oggi: archiviate e con la data passata. Senza sessione (manutenzione),
-- quindi SECURITY DEFINER con il bypass solo dentro la funzione.
CREATE FUNCTION app_tenants_to_purge(max_rows integer)
RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  RETURN QUERY
    SELECT t.id
    FROM "Tenant" t
    WHERE t.status = 'ARCHIVED'
      AND t."deleteAfter" IS NOT NULL
      AND t."deleteAfter" <= (now() AT TIME ZONE 'UTC')
    ORDER BY t."deleteAfter"
    LIMIT max_rows;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

-- Cancella una fioreria SOLO se è ancora in eliminazione e la data è passata (ricontrollato qui:
-- un "Recuperar" arrivato nel frattempo la salva). I dati della fioreria seguono in cascata.
CREATE FUNCTION app_purge_tenant(target uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
  removed integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  DELETE FROM "Tenant" t
  WHERE t.id = target
    AND t.status = 'ARCHIVED'
    AND t."deleteAfter" IS NOT NULL
    AND t."deleteAfter" <= (now() AT TIME ZONE 'UTC');
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('app.bypass_rls', previous, true);
  RETURN removed = 1;
END;
$$;
