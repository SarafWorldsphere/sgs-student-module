from contextlib import contextmanager
from contextvars import ContextVar, Token

from saraswati_tenant.types import School

_school: ContextVar[School | None] = ContextVar("saraswati_school", default=None)


def current_school() -> School:
    school = _school.get()
    if school is None:
        raise RuntimeError("No school is bound to this request. Resolve the host first.")
    return school


@contextmanager
def school_context(school: School):
    token: Token = _school.set(school)
    try:
        yield school
    finally:
        _school.reset(token)
