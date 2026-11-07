"""Resolve a school from the request host and open a database session for it."""

from saraswati_tenant.context import current_school, school_context
from saraswati_tenant.errors import SchoolNotFound, SchoolSuspended
from saraswati_tenant.middleware import SchoolMiddleware
from saraswati_tenant.resolve import normalize_host, resolve_school, set_school_lookup
from saraswati_tenant.s3keys import LEGACY_PREFIXES, assert_key_for_tenant, build_key
from saraswati_tenant.session import apply_rls, open_school_session
from saraswati_tenant.types import School

__all__ = [
    "LEGACY_PREFIXES",
    "School",
    "SchoolMiddleware",
    "SchoolNotFound",
    "SchoolSuspended",
    "apply_rls",
    "assert_key_for_tenant",
    "build_key",
    "current_school",
    "normalize_host",
    "open_school_session",
    "resolve_school",
    "school_context",
    "set_school_lookup",
]
