"""Shared dynamic connection-pool sizing for the Swathi backend."""

import logging
import math

import psycopg
from psycopg_pool import AsyncConnectionPool

log = logging.getLogger(__name__)

DEFAULT_SLOTS = 12
DEFAULT_RESERVE = 0.2
FALLBACK_MAX_CONNECTIONS = 80


def _max_connections(url: str) -> int:
    """Ask the server its own limit. Never fatal — a service must still boot."""
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            return int(conn.execute("SHOW max_connections").fetchone()[0])
    except Exception as exc:
        log.warning(
            "Could not read max_connections (%s); assuming %d",
            exc,
            FALLBACK_MAX_CONNECTIONS,
        )
        return FALLBACK_MAX_CONNECTIONS


def build_pool(
    url: str,
    service: str,
    slots: int = DEFAULT_SLOTS,
    reserve: float = DEFAULT_RESERVE,
) -> AsyncConnectionPool:
    """A pool whose ceiling is this worker's fair share of the database."""
    share = max(2, math.floor(_max_connections(url) * (1 - reserve) / slots))
    log.warning("DB pool for %s: idle 1, burst to %d (slots=%d)", service, share, slots)

    return AsyncConnectionPool(
        conninfo=url,
        min_size=1,
        max_size=share,
        max_idle=300,
        max_lifetime=1800,
        timeout=10,
        check=AsyncConnectionPool.check_connection,
        kwargs={"application_name": service},
        open=False,
    )
