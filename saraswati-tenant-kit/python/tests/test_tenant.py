from saraswati_tenant import (
    School,
    SchoolNotFound,
    SchoolSuspended,
    assert_key_for_tenant,
    build_key,
    current_school,
    normalize_host,
    resolve_school,
    school_context,
    set_school_lookup,
)
from saraswati_tenant.s3keys import TenantKeyError
from saraswati_tenant.session import apply_rls


def _school(**overrides) -> School:
    body = {
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "slug": "sss",
        "status": "active",
        "isolation": "rls",
        "config": {"schoolName": "Shiva Satya Sai School", "database_secret": "nope"},
        "database_secret": None,
    }
    body.update(overrides)
    return School(**body)


def test_normalize_host_strips_port_and_www():
    assert normalize_host("WWW.SSS.SWAIS.IN:443") == "sss.swais.in"
    assert normalize_host("localhost") == "localhost"


def test_normalize_host_rejects_urls():
    try:
        normalize_host("https://sss.swais.in")
    except SchoolNotFound:
        return
    raise AssertionError("expected SchoolNotFound")


def test_resolve_uses_the_injected_lookup_only():
    set_school_lookup(lambda domain: _school() if domain == "sss.swais.in" else None)
    try:
        school = resolve_school("sss.swais.in")
        assert school.slug == "sss"
        assert "database_secret" not in school.public_config()
        assert school.public_config()["tenantId"] == school.tenant_id
    finally:
        set_school_lookup(None)


def test_unknown_and_suspended_hosts():
    def lookup(domain: str):
        if domain == "paused.swais.in":
            return _school(status="suspended", slug="paused")
        return None

    set_school_lookup(lookup)
    try:
        try:
            resolve_school("missing.swais.in")
        except SchoolNotFound:
            pass
        else:
            raise AssertionError("expected SchoolNotFound")
        try:
            resolve_school("paused.swais.in")
        except SchoolSuspended:
            pass
        else:
            raise AssertionError("expected SchoolSuspended")
    finally:
        set_school_lookup(None)


def test_build_key_prefixes_the_current_school():
    with school_context(_school()):
        assert build_key("brand", "logo") == (
            "11111111-1111-1111-1111-111111111111/brand/logo"
        )
        assert current_school().slug == "sss"


def test_build_key_rejects_parent_segments():
    try:
        build_key("brand", "../other", tenant_id="11111111-1111-1111-1111-111111111111")
    except TenantKeyError:
        return
    raise AssertionError("expected TenantKeyError")


def test_legacy_key_is_opt_in():
    tenant = "11111111-1111-1111-1111-111111111111"
    assert_key_for_tenant(f"{tenant}/brand/logo", tenant)
    try:
        assert_key_for_tenant("study-material/class-1/file.pdf", tenant)
    except TenantKeyError:
        pass
    else:
        raise AssertionError("legacy key must be rejected by default")
    assert_key_for_tenant("study-material/class-1/file.pdf", tenant, allow_legacy=True)


class _FakeDb:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))


def test_apply_rls_uses_the_bound_school():
    db = _FakeDb()
    with school_context(_school()):
        apply_rls(db)
    sql, params = db.calls[0]
    assert "set_config" in sql
    assert params == ("11111111-1111-1111-1111-111111111111",)
