-- =============================================================================
-- Gardelia — ruolo dell'app su un Postgres gestito (Neon).
--
-- Da eseguire UNA volta nell'editor SQL di Neon, collegati come proprietario del database
-- (`neondb_owner`), DOPO aver sostituito la password qui sotto con una generata
-- (vedi docs/DEPLOY_VERCEL.md). Non salvare mai la password vera in questo file.
--
-- Modello a due ruoli (docs/ARCHITECTURE.md):
--   neondb_owner → proprietario dello schema: esegue le migrazioni (DATABASE_MIGRATION_URL).
--   gardelia_app → ruolo dell'app (DATABASE_URL): NON superuser, NON BYPASSRLS ⇒ soggetto
--                  alla Row-Level Security. L'app si rifiuta di partire con un ruolo che la aggira.
-- I ruoli creati in SQL non ricevono i privilegi dei ruoli creati dalla console di Neon.
-- =============================================================================

CREATE ROLE gardelia_app LOGIN PASSWORD 'SOSTITUISCI-CON-LA-PASSWORD-GENERATA'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE neondb TO gardelia_app;
GRANT USAGE ON SCHEMA public TO gardelia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gardelia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gardelia_app;

-- Le tabelle e le funzioni create dalle migrazioni future (eseguite da neondb_owner) saranno
-- accessibili a gardelia_app senza altri GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gardelia_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gardelia_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO gardelia_app;
