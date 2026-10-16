"""S3 object keys. Every new key starts with the school id."""

from saraswati_tenant.context import current_school

LEGACY_PREFIXES = (
    "study-material/",
    "assignments/",
    "chapters/",
    "sss/admin/",
)


class TenantKeyError(ValueError):
    """The object key is missing, escapes its prefix, or belongs to another school."""


def build_key(*parts: str, tenant_id: str | None = None) -> str:
    school_id = tenant_id or current_school().tenant_id
    if not school_id or "/" in school_id or school_id in (".", ".."):
        raise TenantKeyError("tenant id cannot be used as an object prefix")
    cleaned: list[str] = [school_id]
    for part in parts:
        piece = part.strip().strip("/")
        if not piece or piece in (".", "..") or ".." in piece.split("/"):
            raise TenantKeyError("object key part is empty or walks out of the prefix")
        cleaned.append(piece)
    if len(cleaned) == 1:
        raise TenantKeyError("object key needs a path after the tenant id")
    return "/".join(cleaned)


def assert_key_for_tenant(key: str, tenant_id: str, *, allow_legacy: bool = False) -> None:
    """Accept a key read from a row this request is allowed to see.

    New keys must start with `{tenant_id}/`. A legacy prefix is accepted only
    when the caller sets allow_legacy after loading the key from a row, never
    from a path the browser supplied.
    """
    if not key or key.startswith("/") or ".." in key.split("/"):
        raise TenantKeyError("object key is not usable")
    if key.startswith(f"{tenant_id}/"):
        return
    if allow_legacy and key.startswith(LEGACY_PREFIXES):
        return
    raise TenantKeyError("object key is outside this school")
