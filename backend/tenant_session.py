"""Bridge the kit's synchronous apply_rls() to the existing async psycopg pool.

Keep tenant resolution and SQL in the shared kit. Its sync execute call is sent
back to the connection's owning event loop through AnyIO's worker-thread bridge.
"""
from anyio import from_thread
from saraswati_tenant import apply_rls
from starlette.concurrency import run_in_threadpool


class _SyncExecuteBridge:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters):
        return from_thread.run(self.connection.execute, statement, parameters)


async def apply_connection_rls(connection) -> None:
    await run_in_threadpool(apply_rls, _SyncExecuteBridge(connection))


class SchoolConnection:
    """Rebind after explicit commit/rollback before allowing further statements."""
    def __init__(self, connection):
        self.raw_connection = connection

    def __getattr__(self, name):
        return getattr(self.raw_connection, name)

    async def commit(self):
        await self.raw_connection.commit()
        await apply_connection_rls(self.raw_connection)

    async def rollback(self):
        await self.raw_connection.rollback()
        await apply_connection_rls(self.raw_connection)
