"""The only place a hostname becomes a school."""

from __future__ import annotations

import os
import time
from collections.abc import Callable
import psycopg
from psycopg.rows import dict_row

from saraswati_tenant.errors import SchoolNotFound, SchoolSuspended
from saraswati_tenant.types import School

Lookup = Callable[[str], School | None]

_lookup: Lookup | None = None
_cache: dict[str, tuple[float, School]] = {}
_CACHE_SECONDS = 60

_LOOKUP_SQL = """
SELECT
    t.tenant_id::text AS tenant_id,
    t.slug,
    t.status,
    t.isolation,
    t.config,
    t.database_secret
FROM platform.tenant_domains AS d
JOIN platform.tenants AS t ON t.tenant_id = d.tenant_id
WHERE d.domain = %s
"""


def set_school_lookup(lookup: Lookup | None) -> None:
    """Tests and local fakes pass a function. Production leaves this unset."""
    global _lookup
    _lookup = lookup
    _cache.clear()


def normalize_host(host: str) -> str:
    value = (host or "").strip().lower()
    if not value or "://" in value or "/" in value or " " in value:
        raise SchoolNotFound(host)
    if value.startswith("[") and "]" in value:
        value = value[1 : value.index("]")]
    elif value.count(":") == 1:
        value = value.split(":", 1)[0]
    value = value.rstrip(".")
    if value.startswith("www.") and value.count(".") >= 2:
        value = value[4:]
    if not value or "." not in value and value != "localhost":
        raise SchoolNotFound(host)
    return value


def resolve_school(host: str) -> School:
    normalized = normalize_host(host)
    cached = _cache.get(normalized)
    now = time.monotonic()
    if cached is not None and now - cached[0] < _CACHE_SECONDS:
        school = cached[1]
    else:
        school = _find(normalized)
        if school is None and normalized != host.strip().lower():
            school = _find(host.strip().lower().split(":")[0].rstrip("."))
        if school is None:
            raise SchoolNotFound(normalized)
        _cache[normalized] = (now, school)
    if school.status != "active":
        raise SchoolSuspended(normalized)
    if school.isolation not in ("rls", "database"):
        raise SchoolNotFound(normalized)
    return school


def _find(domain: str) -> School | None:
    if _lookup is not None:
        return _lookup(domain)
    return _lookup_database(domain)


def _lookup_database(domain: str) -> School | None:
    dsn = os.environ.get("SARASWATI_CONTROL_DATABASE_URL") or os.environ.get(
        "SARASWATI_DATABASE_URL"
    )
    if not dsn:
        raise RuntimeError(
            "Set SARASWATI_CONTROL_DATABASE_URL or SARASWATI_DATABASE_URL before resolving a school."
        )
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        row = connection.execute(_LOOKUP_SQL, (domain,)).fetchone()
    if row is None:
        return None
    config = row["config"] if isinstance(row["config"], dict) else {}
    return School(
        tenant_id=row["tenant_id"],
        slug=row["slug"],
        status=row["status"],
        isolation=row["isolation"],
        config=config,
        database_secret=row["database_secret"],
    )


def clear_school_cache() -> None:
    _cache.clear()
