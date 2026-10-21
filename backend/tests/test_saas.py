"""Host routing, connection binding, and optional real tenant isolation checks."""
import asyncio
from contextlib import asynccontextmanager
from datetime import date, timedelta
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import psycopg
from psycopg.conninfo import conninfo_to_dict
from fastapi.testclient import TestClient
from saraswati_tenant import School, apply_rls, school_context, set_school_lookup
from saraswati_tenant.resolve import clear_school_cache

import database
import main
from settings import get_settings
from tenant_session import SchoolConnection, apply_connection_rls

A = '11111111-1111-1111-1111-111111111111'
B = '22222222-2222-2222-2222-222222222222'
SCHOOLS = {
    'sgs.localhost': School(A, 'sgs', 'active', 'rls', {'schoolName': 'SGS Sample'}),
    'sss.localhost': School(B, 'sss', 'active', 'rls', {'schoolName': 'SSS Sample'}),
    'paused.localhost': School('33333333-3333-3333-3333-333333333333', 'paused', 'suspended', 'rls', {}),
}


class HostRoutingTests(unittest.TestCase):
    def setUp(self):
        set_school_lookup(SCHOOLS.get)
        self.addCleanup(set_school_lookup, None)
        self.client = TestClient(main.app)

    def test_unknown_host_is_404(self):
        self.assertEqual(self.client.get('/health', headers={'host': 'unknown.localhost'}).status_code, 404)

    def test_suspended_school_is_403(self):
        self.assertEqual(self.client.get('/health', headers={'host': 'paused.localhost'}).status_code, 403)

    def test_known_hosts_accept_health(self):
        for host in ['sgs.localhost:8004', 'sss.localhost:8004']:
            self.assertEqual(self.client.get('/health', headers={'host': host}).status_code, 200)

    def test_public_config_uses_host(self):
        r = self.client.get('/public/tenant-config', headers={'host': 'sss.localhost'})
        self.assertEqual(r.json()['schoolName'], 'SSS Sample')
        self.assertEqual(r.json()['tenantId'], B)

    def test_browser_tenant_header_cannot_resolve_unknown_host(self):
        self.assertEqual(self.client.get('/health', headers={'host': 'unknown.localhost', 'x-tenant-id': A}).status_code, 404)

    def test_s3_key_rejects_other_school_prefix(self):
        with school_context(SCHOOLS['sgs.localhost']):
            self.assertEqual(main.parse_s3_location(f's3://sample/{A}/notes.pdf'), ('sample', f'{A}/notes.pdf'))
            with self.assertRaises(ValueError):
                main.parse_s3_location(f's3://sample/{B}/notes.pdf')


class AsyncBindingTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_school_fails_before_pool_checkout(self):
        with patch('database.get_database_pool', new_callable=AsyncMock) as get_pool:
            with self.assertRaises(RuntimeError):
                async with database.database_connection():
                    self.fail('No school must fail closed')
            get_pool.assert_not_awaited()

    async def test_kit_binding_runs_on_async_connection(self):
        connection = AsyncMock()
        with school_context(SCHOOLS['sgs.localhost']):
            await apply_connection_rls(connection)
        connection.execute.assert_awaited_once_with("SELECT set_config('app.tenant_id', %s, true)", (A,))

    async def test_commit_and_rollback_rebind_before_more_queries(self):
        connection = AsyncMock()
        with school_context(SCHOOLS['sgs.localhost']):
            proxy = SchoolConnection(connection)
            await proxy.commit()
            await proxy.rollback()
        self.assertEqual(connection.execute.await_count, 2)

    async def test_superuser_role_is_rejected(self):
        connection = AsyncMock()
        connection.execute.return_value.fetchone.return_value = (True, False)
        with self.assertRaises(RuntimeError):
            await database.verify_rls_role(connection)


ADMIN_URL = os.getenv('SAAS_TEST_ADMIN_URL', '')
if ADMIN_URL and sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@unittest.skipUnless(ADMIN_URL, 'Set SAAS_TEST_ADMIN_URL to a disposable local saraswati_sample database')
class RealTenantIsolationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        details = conninfo_to_dict(ADMIN_URL)
        if details.get('host') not in ['localhost', '127.0.0.1'] or details.get('dbname') != 'saraswati_sample':
            raise RuntimeError('SaaS tests are restricted to local saraswati_sample, never production.')
        get_settings.cache_clear()
        cls.url = get_settings().database_url
        app_details = conninfo_to_dict(cls.url)
        if (app_details.get('host'), app_details.get('dbname'), app_details.get('port', '5432')) != (details.get('host'), details.get('dbname'), details.get('port', '5432')):
            raise RuntimeError('Sample app URL must target the same local test database.')
        cls.students, cls.chapters, cls.subjects, cls.classes, cls.contents, cls.assignments = {}, {}, {}, {}, {}, {}
        with psycopg.connect(ADMIN_URL) as c:
            for hostname, school in SCHOOLS.items():
                c.execute('INSERT INTO platform.tenants (tenant_id, slug, status, isolation, config) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (tenant_id) DO NOTHING',
                          (school.tenant_id, school.slug, school.status, school.isolation, psycopg.types.json.Jsonb(school.config)))
                c.execute('INSERT INTO platform.tenant_domains (domain, tenant_id, verified_at) VALUES (%s,%s,now()) ON CONFLICT (domain) DO NOTHING', (hostname, school.tenant_id))
            for tenant, label in [(A, 'SGS'), (B, 'SSS')]:
                apply_rls(c, tenant)
                def insert(query, args):
                    return c.execute(query, args).fetchone()[0]
                class_id = insert("INSERT INTO class_master (class_name, section_name, record_status) VALUES (%s,'A','Active') RETURNING class_id", (label+' 8',))
                subject = insert("INSERT INTO subject_master (class_id, subject_name, record_status) VALUES (%s,'Science','Active') RETURNING subject_id", (class_id,))
                chapter = insert("INSERT INTO chapter_master (subject_id, chapter_no, chapter_name, record_status) VALUES (%s,1,'Motion','Active') RETURNING chapter_id", (subject,))
                content = insert("INSERT INTO chapter_content (chapter_id,subject_id,subject,lesson,content_title,full_text_content,record_status) VALUES (%s,%s,'Science','Motion','Motion','Speed equals distance divided by time.','Active') RETURNING chapter_content_id", (chapter,subject))
                student = insert("INSERT INTO student_master (full_name,student_email,student_phone,class_id,section,roll_no,admission_no,record_status) VALUES (%s,%s,%s,%s,'A','1',%s,'Active') ON CONFLICT (tenant_id,student_email) WHERE student_email IS NOT NULL DO UPDATE SET class_id=EXCLUDED.class_id RETURNING student_id", (label+' Student','shared@example.com','9999999999',class_id,label+'-sample'))
                assignment = insert("INSERT INTO assignment_master (class_id,subject_id,chapter_id,assignment_title,assignment_text,due_date,record_status) VALUES (%s,%s,%s,%s,'Explain speed',%s,'Active') RETURNING assignment_id", (class_id,subject,chapter,label+' task',date.today()+timedelta(days=2)))
                c.execute("INSERT INTO notice_board (notice_title,notice_text,notice_date,applicable_class,record_status) VALUES (%s,'Sample',CURRENT_DATE,'All','Active')", (label+' notice',))
                teacher = insert("INSERT INTO teacher_master (full_name,class_id) VALUES (%s,%s) RETURNING teacher_id", (label+' Teacher',class_id))
                for kind, percentage in [('assignment',20 if tenant == A else 80), ('test',75 if tenant == A else 35)]:
                    assessment = insert("INSERT INTO assessments (teacher_id,title,assessment_type,subject,class_id,max_marks,record_status) VALUES (%s,%s,%s,'Science',%s,100,'Active') RETURNING assessment_id", (teacher,label+' '+kind,kind,class_id))
                    c.execute("INSERT INTO assessment_results (assessment_id,student_id,roll_number,marks_obtained,percentage,record_status) VALUES (%s,%s,'1',%s,%s,'Active')", (assessment,student,percentage,percentage))
                cls.students[tenant],cls.chapters[tenant],cls.subjects[tenant],cls.classes[tenant],cls.contents[tenant],cls.assignments[tenant]=student,chapter,subject,class_id,content,assignment
        with psycopg.connect(cls.url) as c:
            flags = c.execute('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
            if any(flags):raise RuntimeError('Integration must run as a non-bypass app role.')
        set_school_lookup(None)  # Real kit resolver and real platform tables.

    async def asyncSetUp(self):
        clear_school_cache()
        self.lifespan = main.lifespan(main.app)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://sgs.localhost')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)

    async def test_same_email_isolated_by_host_and_connection_reuse(self):
        for host, name in [('sgs.localhost','SGS Student'), ('sss.localhost','SSS Student'), ('sgs.localhost','SGS Student')]:
            response = await self.client.get('/students/current', params={'email':'shared@example.com'}, headers={'host':host,'x-tenant-id':B})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['student']['full_name'],name)

    async def test_concurrent_school_requests_do_not_cross(self):
        async def request(host, expected):
            r=await self.client.get('/students/current',params={'email':'shared@example.com'},headers={'host':host})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(r.json()['student']['full_name'],expected)
        await asyncio.gather(*(request(host,name) for _ in range(4) for host,name in [('sgs.localhost','SGS Student'),('sss.localhost','SSS Student')]))

    async def test_raw_connection_without_tenant_sees_zero(self):
        with psycopg.connect(self.url) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM student_master').fetchone()[0],0)

    async def test_transaction_binding_after_commit_and_rollback(self):
        with school_context(SCHOOLS['sgs.localhost']):
            async with database.database_connection() as c:
                for operation in [c.commit,c.rollback]:
                    await operation()
                    rows=await (await c.execute('SELECT full_name FROM student_master')).fetchall()
                    self.assertEqual([r[0] for r in rows],['SGS Student'])

    async def test_cross_school_update_and_insert_fail(self):
        with school_context(SCHOOLS['sgs.localhost']):
            async with database.database_connection() as c:
                r=await c.execute('UPDATE student_master SET full_name=%s WHERE student_id=%s',('Not allowed',self.students[B]))
                self.assertEqual(r.rowcount,0)
            with self.assertRaises(psycopg.Error):
                async with database.database_connection() as c:
                    await c.execute('INSERT INTO student_master (tenant_id,full_name) VALUES (%s,%s)',(B,'Not allowed'))

    async def test_sample_read_endpoints_against_real_kit_schema(self):
        params={'email':'shared@example.com','class_id':self.classes[A],'subject_id':self.subjects[A], 'chapter_id':self.chapters[A],
                'student_id':self.students[A],'chapter_content_id':self.contents[A],'subject':'Science','lesson':'Motion'}
        paths=['/health/db','/students/current','/classes','/subjects','/chapter-content','/study-materials','/quiz-chapters',
               '/notices','/notifications','/help-support','/student-analysis','/student-progress','/student-performance-summary']
        for path in paths:
            with self.subTest(path=path):
                response=await self.client.get(path,params=params)
                self.assertEqual(response.status_code,200,response.text)

    async def test_learning_profile_and_notification_upserts(self):
        body={'student_id':self.students[A],'chapter_id':self.chapters[A],'chapter_title':'Motion','reading_time_minutes':10,
              'quiz_score':70,'retry_count':1,'comprehension_score':70}
        for _ in range(2):
            r=await self.client.post('/student-learning-profile',json=body)
            self.assertEqual(r.status_code,200,r.text)
            r=await self.client.post('/notifications/read',json={'email':'shared@example.com','notification_ids':['notice-1']})
            self.assertEqual(r.status_code,200,r.text)

    async def test_canonical_assessment_percentages_stay_percentages(self):
        response=await self.client.get('/student-performance-summary',params={'student_id':self.students[A]})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['assignment_marks'],20)
        self.assertEqual(response.json()['unit_test_marks'],75)

    async def test_assignment_submission_insert_update_and_foreign_id(self):
        body={'assignment_id':self.assignments[A],'student_email':'shared@example.com','file_name':'answer.txt',
              'file_type':'text/plain','file_size':5,'file_content_base64':'SGVsbG8='}
        for _ in range(2):
            response=await self.client.post('/assignments/submit',json=body)
            self.assertEqual(response.status_code,200,response.text)
        body['assignment_id']=self.assignments[B]
        response=await self.client.post('/assignments/submit',json=body)
        self.assertEqual(response.status_code,404,response.text)


if __name__ == '__main__':
    unittest.main()
