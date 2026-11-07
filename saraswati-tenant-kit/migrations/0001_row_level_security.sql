-- Run this after every file in src/.
-- Requires PostgreSQL 14 or newer (EXECUTE FUNCTION).
--
-- Greenfield: src/ already created tenant_id NOT NULL, so this file only
-- installs the session helper, the stamp trigger, and one policy per table.
--
-- Existing database: load the rows into the src tables first (with tenant_id
-- filled in), apply src, then run this file. Do not enable the policy before
-- the application sets app.tenant_id on every request.

CREATE OR REPLACE FUNCTION platform.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION platform.stamp_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = platform, public
AS $$
DECLARE
    current_tenant uuid := platform.current_tenant_id();
BEGIN
    IF current_tenant IS NULL THEN
        RAISE EXCEPTION 'app.tenant_id is not set';
    END IF;
    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := current_tenant;
    ELSIF NEW.tenant_id IS DISTINCT FROM current_tenant THEN
        RAISE EXCEPTION 'tenant_id does not match the request school';
    END IF;
    RETURN NEW;
END
$$;

DO $$
DECLARE
    table_name text;
BEGIN
    FOR table_name IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
              SELECT 1
              FROM pg_attribute a
              WHERE a.attrelid = c.oid
                AND a.attname = 'tenant_id'
                AND NOT a.attisdropped
          )
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I
               USING (tenant_id = (SELECT platform.current_tenant_id()))
               WITH CHECK (tenant_id = (SELECT platform.current_tenant_id()))',
            table_name
        );
        EXECUTE format('DROP TRIGGER IF EXISTS stamp_tenant ON public.%I', table_name);
        EXECUTE format(
            'CREATE TRIGGER stamp_tenant
               BEFORE INSERT OR UPDATE ON public.%I
               FOR EACH ROW EXECUTE FUNCTION platform.stamp_tenant_id()',
            table_name
        );
    END LOOP;
END
$$;
