"""One tagged async database pool per worker, using the shared sizing helper.

Size is calculated at startup. Persistent connections open on the first DB request.
"""
import asyncio
from contextlib import asynccontextmanager

from psycopg_pool import AsyncConnectionPool, PoolTimeout
from starlette.concurrency import run_in_threadpool

from pool_psycopg import build_pool
from settings import get_settings

SERVICE_NAME = "sgs-student-api"
_pool: AsyncConnectionPool | None = None
_open_lock: asyncio.Lock | None = None
_opened = False


async def initialize_database_pool() -> None:
    global _pool, _open_lock, _opened
    if _pool is not None:
        return
    settings = get_settings()
    # The shared helper's short SHOW max_connections probe is synchronous.
    _pool = await run_in_threadpool(
        build_pool,
        url=settings.database_url,
        service=SERVICE_NAME,
        slots=settings.db_service_slots,
        reserve=settings.db_pool_reserve,
    )
    _open_lock = asyncio.Lock()
    _opened = False


async def get_database_pool() -> AsyncConnectionPool:
    global _opened, _pool
    if _pool is None or _open_lock is None:
        raise RuntimeError("Database pool was not initialized during application startup.")
    async with _open_lock:
        if not _opened:
            # Open once even if several first requests arrive concurrently.
            try:
                # Wait for the minimum connection before checkout: otherwise the
                # first queued checkout can grow the pool even without concurrency.
                await _pool.open(wait=True, timeout=10)
            except PoolTimeout:
                # wait=True closes the failed pool. Prepare a fresh unopened one
                # so a later request can recover when the database becomes available.
                await _pool.close()
                settings = get_settings()
                _pool = await run_in_threadpool(
                    build_pool, url=settings.database_url, service=SERVICE_NAME,
                    slots=settings.db_service_slots, reserve=settings.db_pool_reserve,
                )
                raise
            _opened = True
    return _pool


@asynccontextmanager
async def database_connection():
    pool = await get_database_pool()
    async with pool.connection() as connection:
        yield connection


async def close_database_pool() -> None:
    global _pool, _open_lock, _opened
    pool = _pool
    _pool = None
    _open_lock = None
    _opened = False
    if pool is not None:
        await pool.close()
