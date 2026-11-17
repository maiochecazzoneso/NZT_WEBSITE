-- NZT Area Clienti - least-privilege database roles (spec §2 rule 2).
--
-- Run ONCE as a PostgreSQL superuser / admin, with psql variables:
--   psql -v ON_ERROR_STOP=1 \
--        -v db_name=nzt \
--        -v migrator_password='...' \
--        -v app_password='...' \
--        -f scripts/db/roles.sql
--
-- Result:
--   nzt_migrator : owns the database and schema "public"; runs Alembic (DDL).
--   nzt_app      : runtime role used by the API; only SELECT/INSERT/UPDATE/DELETE
--                  on tables in schema "public". No DDL, no TRUNCATE, no superuser.

CREATE ROLE nzt_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
    PASSWORD :'migrator_password';
CREATE ROLE nzt_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
    PASSWORD :'app_password';

CREATE DATABASE :"db_name" OWNER nzt_migrator;

\connect :"db_name"

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO nzt_app;

ALTER SCHEMA public OWNER TO nzt_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nzt_app;

-- Every table created later by the migrator is automatically DML-only for the app.
ALTER DEFAULT PRIVILEGES FOR ROLE nzt_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nzt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nzt_migrator IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nzt_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO nzt_app;

-- Defensive runtime limits for the application role.
ALTER ROLE nzt_app SET statement_timeout = '15s';
ALTER ROLE nzt_app SET idle_in_transaction_session_timeout = '30s';
