-- Control plane. One row per school. The browser receives `config` only.
-- `database_secret` is a secret-manager name, used when isolation = 'database'.
-- It is never returned by GET /public/tenant-config.

CREATE TABLE platform.tenants (
    tenant_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL,
    status          text NOT NULL DEFAULT 'active',
    isolation       text NOT NULL DEFAULT 'rls',
    config          jsonb NOT NULL,
    database_secret text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenants_slug_key UNIQUE (slug),
    CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
    CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended')),
    CONSTRAINT tenants_isolation_check CHECK (isolation IN ('rls', 'database')),
    CONSTRAINT tenants_database_secret_only_when_isolated
        CHECK (
            (isolation = 'database' AND database_secret IS NOT NULL)
            OR (isolation = 'rls' AND database_secret IS NULL)
        )
);

CREATE TABLE platform.tenant_domains (
    domain      text PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES platform.tenants (tenant_id),
    verified_at timestamptz,
    CONSTRAINT tenant_domains_domain_lowercase CHECK (domain = lower(domain) AND domain !~ '[:/]')
);

CREATE INDEX tenant_domains_tenant_id_idx
    ON platform.tenant_domains (tenant_id);

COMMENT ON TABLE platform.tenants IS
    'One school. config is the public branding JSON. database_secret is not public.';
COMMENT ON TABLE platform.tenant_domains IS
    'Hostname that resolves to a school. Lowercase, no port, no path.';
