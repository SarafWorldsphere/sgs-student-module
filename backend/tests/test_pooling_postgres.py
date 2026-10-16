"""Optional integration test against a disposable local PostgreSQL database.

Set POOL_TEST_DATABASE_URL to opt in. Creates only a session-local temporary table.
"""
import asyncio
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import PoolTimeout
import database
import main

URL = os.getenv('POOL_TEST_DATABASE_URL', '')
if URL and sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@unittest.skipUnless(URL, 'Set POOL_TEST_DATABASE_URL for disposable local PostgreSQL verification')
class PostgresPoolingTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_reuse_commit_rollback_ceiling_and_shutdown(self):
        self.assertIn(conninfo_to_dict(URL).get('host'), ['127.0.0.1', 'localhost'],
                      'This integration test is restricted to a local disposable database.')
        settings = SimpleNamespace(database_url=URL, db_service_slots=40, db_pool_reserve=0.2)

        def tagged_count():
            with psycopg.connect(URL, autocommit=True) as observer:
                return observer.execute("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'sgs-student-api'").fetchone()[0]

        with patch('database.get_settings', return_value=settings):
            async with main.lifespan(main.app):
                self.assertEqual(tagged_count(), 0)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                    self.assertEqual((await client.get('/health')).status_code, 200)
                    self.assertEqual(tagged_count(), 0)
                    self.assertEqual((await client.get('/health/db')).status_code, 200)
                async with database.database_connection() as conn:
                    first_pid = (await (await conn.execute('SELECT pg_backend_pid()')).fetchone())[0]
                    tag = (await (await conn.execute('SHOW application_name')).fetchone())[0]
                    self.assertEqual(tag, 'sgs-student-api')
                    await conn.execute('CREATE TEMP TABLE pooling_transaction_test (id integer)')
                    await conn.execute('INSERT INTO pooling_transaction_test VALUES (1)')
                # The normal pool context committed; the next checkout reuses the session.
                async with database.database_connection() as conn:
                    second_pid = (await (await conn.execute('SELECT pg_backend_pid()')).fetchone())[0]
                    self.assertEqual(first_pid, second_pid)
                    self.assertEqual((await (await conn.execute('SELECT count(*) FROM pooling_transaction_test')).fetchone())[0], 1)
                with self.assertRaises(ValueError):
                    async with database.database_connection() as conn:
                        await conn.execute('INSERT INTO pooling_transaction_test VALUES (2)')
                        raise ValueError('Force rollback')
                async with database.database_connection() as conn:
                    self.assertEqual((await (await conn.execute('SELECT count(*) FROM pooling_transaction_test')).fetchone())[0], 1)
                self.assertEqual(tagged_count(), 1)
                pool = await database.get_database_pool()
                self.assertEqual(pool.max_size, 2)
                async with pool.connection(), pool.connection():
                    with self.assertRaises(PoolTimeout):
                        async with pool.connection(timeout=0.05):
                            self.fail('Should time out at the configured ceiling')
                    self.assertEqual(tagged_count(), 2)
            self.assertEqual(tagged_count(), 0)


if __name__ == '__main__':
    unittest.main()
