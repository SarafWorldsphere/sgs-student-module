"""Optional local SQL test of the real SaaS connection path and timetable RLS."""
import asyncio
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg_pool import AsyncConnectionPool
from fastapi import FastAPI, HTTPException
from saraswati_tenant import School, SchoolMiddleware, set_school_lookup

import database
import main
from student_timetable import create_student_timetable_router

URL = os.getenv('TIMETABLE_TEST_DATABASE_URL', '')
if URL and sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
A = '11111111-1111-1111-1111-111111111111'
B = '22222222-2222-2222-2222-222222222222'
SCHOOLS = {host: School(tenant, label, 'active', 'rls', {}) for host, tenant, label in
           [('sgs.localhost', A, 'sgs'), ('sss.localhost', B, 'sss')]}


@unittest.skipUnless(URL, 'Set a disposable local TIMETABLE_TEST_DATABASE_URL for RLS checks')
class TimetableTenantTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        details = conninfo_to_dict(URL)
        if details.get('host') not in ('localhost', '127.0.0.1') or details.get('dbname') != 'student_timetable_test':
            raise RuntimeError('Only local student_timetable_test may be used')
        self.schema = 'timetable_test_' + uuid4().hex
        self.role = 'timetable_reader_' + uuid4().hex
        with psycopg.connect(URL, autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE ROLE {} LOGIN NOSUPERUSER NOBYPASSRLS').format(sql.Identifier(self.role)))
            admin.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
            admin.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(self.schema)))
            admin.execute('''
                CREATE TABLE class_master (tenant_id uuid, class_id bigint, class_name text, academic_year text, section_name text);
                CREATE TABLE student_master (tenant_id uuid, student_id bigint, full_name text, roll_no text, admission_no text,
                    class_id bigint, class_name text, section text, student_email text, student_phone text, record_status text);
                CREATE TABLE teacher_master (tenant_id uuid, teacher_id bigint, full_name text);
                CREATE TABLE period_master (tenant_id uuid, period_id bigint, academic_year text, schedule_type text,
                    period_no int, period_label text, start_time time, end_time time, is_teaching boolean);
                CREATE TABLE timetable (tenant_id uuid, timetable_id bigint, academic_year text, class_id bigint, section text,
                    day_of_week int, period_no int, subject_name text, teacher_id bigint);
            ''')
            for tenant, label in [(A, 'SGS'), (B, 'SSS')]:
                admin.execute("INSERT INTO class_master VALUES (%s,18,%s,'2026-27','A')", (tenant, label+' 8'))
                admin.execute("INSERT INTO student_master VALUES (%s,1,%s,'1','A1',18,'8','A','shared@example.com',NULL,'Active')", (tenant, label+' Student'))
                admin.execute('INSERT INTO teacher_master VALUES (%s,1,%s)', (tenant, label+' Teacher'))
                for n in range(1, 10):
                    admin.execute("INSERT INTO period_master VALUES (%s,%s,'2026-27','full',%s,%s,'09:00','09:40',true)", (tenant,n,n,f'Period {n}'))
                admin.execute("INSERT INTO timetable VALUES (%s,1,'2026-27',18,'A',1,9,%s,1)", (tenant, label+' Subject'))
            for table in ['class_master', 'student_master', 'teacher_master', 'period_master', 'timetable']:
                name = sql.Identifier(table)
                admin.execute(sql.SQL('ALTER TABLE {} ENABLE ROW LEVEL SECURITY').format(name))
                admin.execute(sql.SQL('ALTER TABLE {} FORCE ROW LEVEL SECURITY').format(name))
                admin.execute(sql.SQL("CREATE POLICY school ON {} USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)").format(name))
            admin.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(self.schema), sql.Identifier(self.role)))
            admin.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(self.schema), sql.Identifier(self.role)))
        self.pool = AsyncConnectionPool(make_conninfo(URL, user=self.role, password='', options=f'-c search_path={self.schema}'), min_size=1, max_size=1, open=False)
        await self.pool.open(wait=True)
        self.pool_patch = patch.object(database, 'get_database_pool', new=AsyncMock(return_value=self.pool))
        self.pool_patch.start()
        set_school_lookup(SCHOOLS.get)
        app = FastAPI()
        app.add_middleware(SchoolMiddleware)
        app.include_router(create_student_timetable_router(main.get_connection, main.fetch_current_student_record))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://sgs.localhost')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.pool_patch.stop()
        set_school_lookup(None)
        await self.pool.close()
        with psycopg.connect(URL, autocommit=True) as admin:
            admin.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)))
            admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(self.role)))

    async def test_same_email_and_ids_are_isolated_across_reused_connection(self):
        for host, label in [('sgs.localhost','SGS'), ('sss.localhost','SSS'), ('sgs.localhost','SGS')]:
            response = await self.client.get('/timetable', params={'email':'shared@example.com'}, headers={'host':host, 'x-tenant-id':B})
            self.assertEqual(response.status_code,200,response.text)
            data = response.json()
            self.assertEqual(data['student']['full_name'],label+' Student')
            self.assertEqual(len(data['periods']),9)
            self.assertEqual([slot['subject_name'] for slot in data['days'][0]['slots']], [label+' Subject'])
            self.assertEqual(data['days'][0]['slots'][0]['teacher_name'],label+' Teacher')

    async def test_unknown_host_is_rejected_and_no_context_cannot_checkout(self):
        response = await self.client.get('/timetable',params={'email':'shared@example.com'},headers={'host':'unknown.localhost','x-tenant-id':A})
        self.assertEqual(response.status_code,404)
        with self.assertRaises(HTTPException) as error:
            async with main.get_connection():
                self.fail('Missing school must fail closed')
        self.assertEqual(error.exception.status_code,503)
