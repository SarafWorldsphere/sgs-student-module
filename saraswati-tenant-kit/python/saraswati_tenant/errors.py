class SchoolNotFound(LookupError):
    """The Host header is not a domain in platform.tenant_domains."""


class SchoolSuspended(PermissionError):
    """The domain belongs to a school whose status is not active."""
