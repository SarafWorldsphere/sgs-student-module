-- Schemas. School tables live in public. The control plane lives in platform
-- and is not covered by the tenant row-level security migration.

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS public;
