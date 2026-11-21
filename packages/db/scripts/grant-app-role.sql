-- Privilegi del ruolo applicativo sul database corrente.
-- Idempotente; da eseguire dopo la creazione del database (vedi setup-local-roles.sql).
-- I privilegi di default fanno sì che le tabelle create dalle migrazioni future
-- (eseguite da floral_owner) siano accessibili a floral_app senza GRANT espliciti.

GRANT CONNECT ON DATABASE :"DBNAME" TO floral_app;
GRANT USAGE ON SCHEMA public TO floral_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO floral_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO floral_app;

ALTER DEFAULT PRIVILEGES FOR ROLE floral_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO floral_app;
ALTER DEFAULT PRIVILEGES FOR ROLE floral_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO floral_app;
ALTER DEFAULT PRIVILEGES FOR ROLE floral_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO floral_app;
