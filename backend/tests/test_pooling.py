"""Offline pooling and API regressions. No production database or AI calls."""
import asyncio
import ast
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg_pool import PoolTimeout

from saraswati_tenant import School, school_context, set_school_lookup
import database
import main
import pool_psycopg
from settings import Settings
from utils import ai_tracker
from ai_learning_path_service import GeminiLearningPathLLM, MockLearningPathLLM, TRACKS


class FakeConnection:
    def __init__(self):
        self.execute = AsyncMock()
        self.executemany = AsyncMock()
        self.fetchone = AsyncMock(return_value=(1,))
        self.fetchall = AsyncMock(return_value=[])
        self.commit = AsyncMock()
        self.rollback = AsyncMock()

    @asynccontextmanager
    async def cursor(self, **kwargs):
        yield self


class FakePool:
    def __init__(self):
        self.open = AsyncMock()
        self.close = AsyncMock()
        self.conn = FakeConnection()
        self.acquisitions = 0
        self.failures = []

    @asynccontextmanager
    async def connection(self):
        self.acquisitions += 1
        try:
            yield self.conn
        except BaseException as exc:
            self.failures.append(type(exc))
            raise


SCHOOL = School('11111111-1111-1111-1111-111111111111', 'sgs', 'active', 'rls', {})

SETTINGS = SimpleNamespace(database_url='postgresql://unused/test', db_service_slots=40,
                           db_pool_reserve=0.2, client_name='SGS')


class PoolLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        context = school_context(SCHOOL)
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)
        role_check = patch('database.verify_rls_role', new_callable=AsyncMock)
        role_check.start()
        self.addCleanup(role_check.stop)

    async def asyncTearDown(self):
        await database.close_database_pool()

    async def test_lazy_concurrent_open_and_same_pool(self):
        pool = FakePool()
        with patch('database.get_settings', return_value=SETTINGS), patch('database.build_pool', return_value=pool) as build:
            await database.initialize_database_pool()
            build.assert_called_once_with(url=SETTINGS.database_url, service='sgs-student-api', slots=40, reserve=0.2)
            pool.open.assert_not_awaited()

            async def query():
                async with database.database_connection() as conn:
                    self.assertIs(conn.raw_connection, pool.conn)

            await asyncio.gather(*(query() for _ in range(10)))
            pool.open.assert_awaited_once()
            self.assertEqual(pool.acquisitions, 10)
            await database.close_database_pool()
            pool.close.assert_awaited_once()

    async def test_request_error_releases_pool_context(self):
        pool = FakePool()
        with patch('database.get_settings', return_value=SETTINGS), patch('database.build_pool', return_value=pool):
            await database.initialize_database_pool()
            with self.assertRaises(ValueError):
                async with database.database_connection():
                    raise ValueError('rollback this transaction')
            self.assertEqual(pool.failures, [ValueError])
            async with database.database_connection() as conn:
                self.assertIs(conn.raw_connection, pool.conn)

    async def test_initial_timeout_can_recover_on_next_request(self):
        failed, healthy = FakePool(), FakePool()
        failed.open.side_effect = PoolTimeout('database temporarily unavailable')
        with patch('database.get_settings', return_value=SETTINGS), patch('database.build_pool', side_effect=[failed, healthy]):
            await database.initialize_database_pool()
            with self.assertRaises(PoolTimeout):
                await database.get_database_pool()
            failed.close.assert_awaited_once()
            async with database.database_connection() as conn:
                self.assertIs(conn.raw_connection, healthy.conn)
            healthy.open.assert_awaited_once_with(wait=True, timeout=10)

    async def test_timeout_maps_to_503(self):
        @asynccontextmanager
        async def exhausted():
            raise PoolTimeout('busy')
            yield

        with patch('main.database_connection', exhausted):
            with self.assertRaises(HTTPException) as error:
                async with main.get_connection():
                    self.fail('Must not acquire an exhausted pool')
        self.assertEqual(error.exception.status_code, 503)

    async def test_ai_logging_uses_same_pool_and_settings(self):
        pool = FakePool()
        with patch('database.get_settings', return_value=SETTINGS), patch('database.build_pool', return_value=pool), patch('utils.ai_tracker.get_settings', return_value=SETTINGS):
            await database.initialize_database_pool()
            self.assertTrue(await ai_tracker.log_ai_usage(module_name='Quiz', feature_used='Generate',
                                                         response={'usageMetadata': {'promptTokenCount': 2, 'candidatesTokenCount': 3}}))
            self.assertEqual(pool.acquisitions, 1)
            params = next(call.args[1] for call in pool.conn.execute.call_args_list if 'INSERT INTO' in call.args[0])
            self.assertEqual(params[0], 'SGS')
            self.assertEqual(params[-3:], (2, 3, 5))

    async def test_logging_failure_does_not_fail_feature(self):
        @asynccontextmanager
        async def exhausted():
            raise PoolTimeout('busy')
            yield
        with patch('utils.ai_tracker.database_connection', exhausted), patch('utils.ai_tracker.get_settings', return_value=SETTINGS):
            self.assertFalse(await ai_tracker.log_ai_usage(module_name='Quiz', feature_used='Generate'))

    async def test_learning_path_adapters_remain_awaitable(self):
        classification = next(iter(TRACKS))
        metrics = {'comprehension_score': 70, 'quiz_score': 70, 'retry_count': 1, 'reading_time_minutes': 10}
        result = await MockLearningPathLLM().generate_path('Motion', classification, metrics)
        self.assertEqual(result['chapter_title'], 'Motion')
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'dummy'}):
            adapter = GeminiLearningPathLLM()
        body = {'candidates': [{'content': {'parts': [{'text': '{"summary":"Test","steps":["Read"]}'}]}}]}
        with patch.object(adapter, '_generate_content', return_value=body), patch('ai_learning_path_service.log_ai_usage', new_callable=AsyncMock) as log:
            result = await adapter.generate_path('Motion', classification, metrics)
            self.assertEqual(result['summary'], 'Test')
            log.assert_awaited_once()


class SettingsAndSizingTests(unittest.TestCase):
    def test_dotenv_slots_loaded_without_os_export(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            env = Path(folder) / '.env'
            env.write_text('DATABASE_URL=postgresql://unused/test\nDB_SERVICE_SLOTS=40\n')
            self.assertEqual(Settings(_env_file=env).db_service_slots, 40)
            self.assertNotIn('DB_SERVICE_SLOTS', os.environ)

    def test_environment_overrides_file_and_validates_slots(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://unused/test', 'DB_SERVICE_SLOTS': '12'}):
            self.assertEqual(Settings(_env_file=None).db_service_slots, 12)
        with self.assertRaises(ValueError):
            Settings(_env_file=None, DATABASE_URL='postgresql://unused/test', DB_SERVICE_SLOTS=0)

    def test_shared_helper_dynamic_ceiling_and_tag(self):
        for slots, expected in [(12, 5), (40, 2)]:
            with self.subTest(slots=slots), patch('pool_psycopg._max_connections', return_value=80), patch('pool_psycopg.AsyncConnectionPool') as factory:
                pool_psycopg.build_pool('postgresql://unused/test', 'sgs-student-api', slots=slots)
                kwargs = factory.call_args.kwargs
                self.assertEqual(kwargs['min_size'], 1)
                self.assertEqual(kwargs['max_size'], expected)
                self.assertEqual(kwargs['kwargs']['application_name'], 'sgs-student-api')
                self.assertFalse(kwargs['open'])

    def test_shared_helper_probe_fallback(self):
        with patch('pool_psycopg.psycopg.connect', side_effect=RuntimeError('unavailable')):
            self.assertEqual(pool_psycopg._max_connections('postgresql://unused/test'), 80)

    def test_only_shared_probe_uses_direct_connect(self):
        backend = Path(__file__).resolve().parents[1]
        for relative in ['main.py', 'student_analysis.py', 'utils/ai_tracker.py']:
            tree = ast.parse((backend / relative).read_text(encoding='utf-8'))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    self.assertNotEqual(ast.unparse(node.func), 'psycopg.connect', relative)


class ApiRegressionTests(unittest.TestCase):
    def setUp(self):
        set_school_lookup(lambda host: SCHOOL if host == 'sgs.localhost' else None)
        self.addCleanup(set_school_lookup, None)
        role_check = patch('database.verify_rls_role', new_callable=AsyncMock)
        role_check.start()
        self.addCleanup(role_check.stop)
        self.pool = FakePool()
        self.settings = patch('database.get_settings', return_value=SETTINGS)
        self.build = patch('database.build_pool', return_value=self.pool)
        self.settings.start()
        self.build.start()
        self.addCleanup(self.settings.stop)
        self.addCleanup(self.build.stop)

    def test_health_does_not_open_pool_db_health_reuses_it(self):
        with TestClient(main.app, base_url='http://sgs.localhost') as client:
            self.assertEqual(client.get('/health').status_code, 200)
            self.pool.open.assert_not_awaited()
            for _ in range(2):
                self.assertEqual(client.get('/health/db').status_code, 200)
            self.pool.open.assert_awaited_once()
            self.assertEqual(self.pool.acquisitions, 2)
        self.pool.close.assert_awaited_once()

    def test_current_student_route(self):
        student = {'student_id': 1, 'class_id': 8, 'full_name': 'Demo', 'student_email': 'test@example.com'}
        self.pool.conn.fetchone.return_value = student
        with TestClient(main.app, base_url='http://sgs.localhost') as client:
            response = client.get('/students/current', params={'email': 'test@example.com'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['student'], student)

    def test_student_analysis_factory_stays_synchronous(self):
        self.pool.conn.fetchone.return_value = {'student_id': 1, 'full_name': 'Demo', 'student_email': 'test@example.com',
                                               'class_id': 8, 'class_name': '8', 'section': 'A', 'roll_no': '1', 'admission_no': 'T1'}
        with TestClient(main.app, base_url='http://sgs.localhost') as client:
            response = client.get('/student-analysis', params={'email': 'test@example.com'})
        self.assertEqual(response.status_code, 200)
        self.pool.conn.fetchall.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
