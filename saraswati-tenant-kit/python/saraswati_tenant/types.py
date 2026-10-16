from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class School:
    tenant_id: str
    slug: str
    status: str
    isolation: str
    config: dict[str, Any]
    database_secret: str | None = None

    def public_config(self) -> dict[str, Any]:
        """Branding JSON for the browser. Never includes the database secret."""
        body = dict(self.config)
        body["tenantId"] = self.tenant_id
        body["slug"] = self.slug
        body.pop("database_secret", None)
        body.pop("databaseSecret", None)
        return body
