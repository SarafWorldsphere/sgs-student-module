-- Run after 0001_row_level_security.sql.
-- Creates the role the websites inherit. It cannot bypass row-level security
-- and it cannot insert into the control plane.
--
-- The login user the apps already use (swais_app_user) is not created here
-- and no password is stored in this file. After this migration:
--
--   GRANT saraswati_app TO swais_app_user;
--   ALTER ROLE swais_app_user NOSUPERUSER NOBYPASSRLS;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saraswati_app') THEN
        CREATE ROLE saraswati_app NOLOGIN NOBYPASSRLS;
    END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO saraswati_app;
GRANT USAGE ON SCHEMA platform TO saraswati_app;

GRANT SELECT ON ALL TABLES IN SCHEMA platform TO saraswati_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO saraswati_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO saraswati_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO saraswati_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO saraswati_app;
