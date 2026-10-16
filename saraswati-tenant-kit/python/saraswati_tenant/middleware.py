from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from saraswati_tenant.context import school_context
from saraswati_tenant.errors import SchoolNotFound, SchoolSuspended
from saraswati_tenant.resolve import resolve_school


class SchoolMiddleware(BaseHTTPMiddleware):
    """Read the Host header once and bind that school for the rest of the request."""

    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "")
        try:
            school = resolve_school(host)
        except SchoolNotFound:
            return JSONResponse({"detail": "Unknown school"}, status_code=404)
        except SchoolSuspended:
            return JSONResponse({"detail": "School suspended"}, status_code=403)
        with school_context(school):
            return await call_next(request)
