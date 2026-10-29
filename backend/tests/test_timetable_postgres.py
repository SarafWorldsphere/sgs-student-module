"""Optional real SQL check, restricted to a disposable local database.

All fixture tables are temporary and disappear when the connection closes.
"""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
import httpx
import psycopg
from psycopg.conninfo import conninfo_to_dict
import main
from student_timetable import create_student_timetable_router

URL = os.environ.get("TIMETABLE_TEST_DATABASE_URL", "")
if URL and sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@unittest.skipUnless(URL, "Set TIMETABLE_TEST_DATABASE_URL for the optional local SQL verification")
class TimetablePostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        details = conninfo_to_dict(URL)
        if details.get("host") not in ("localhost", "127.0.0.1") or details.get("dbname") != "student_timetable_test":
            raise RuntimeError("Timetable SQL tests require local student_timetable_test, never staging or production.")
        self.connection = await psycopg.AsyncConnection.connect(URL)
        await self.connection.execute("""
            CREATE TEMP TABLE sgs_class_master (class_id bigint, class_name text, academic_year text, section_name text);
            CREATE TEMP TABLE sgs_student_master (student_id bigint, full_name text, roll_no text, admission_no text,
                class_id bigint, class_name text, section text, student_email text, student_phone text, record_status text);
            CREATE TEMP TABLE sgs_period_master (period_id bigint, academic_year text, schedule_type text,
                period_no integer, period_label text, start_time time, end_time time, is_teaching boolean, record_status text);
            CREATE TEMP TABLE sgs_timetable (timetable_id bigint, academic_year text, class_id bigint, section text,
                day_of_week integer, period_no integer, subject_name text, teacher_id text, record_status text);
            CREATE TEMP TABLE sgs_teacher_master (teacher_id text, full_name text);
            INSERT INTO sgs_class_master VALUES (18,'Class 8','2026-27','A'),(19,'Class 9','2026-27','B');
            INSERT INTO sgs_student_master VALUES (1,'Student A','1','A1',18,'Class 8','A','student@gmail.com',NULL,'Active');
            INSERT INTO sgs_teacher_master VALUES ('T1','Maths Teacher'),('T2','English Teacher');
            INSERT INTO sgs_period_master VALUES
                (1,'2026-27','full',0,'Assembly','09:00','09:15',false,'Active'),
                (2,'2026-27','full',1,'Period 1','09:15','10:00',true,'Active'),
                (3,'2026-27','full',2,'Break','10:00','10:15',false,'Active'),
                (4,'2026-27','full',3,'Period 2','10:15','11:00',true,'Active'),
                (5,'2026-27','half',1,'Period 1','08:00','08:40',true,'Active'),
                (6,'2026-27','full',9,'Inactive','13:00','13:40',true,'Inactive'),
                (7,'2027-28','full',1,'Future year','09:00','10:00',true,'Active');
            INSERT INTO sgs_timetable VALUES
                (1,'2026-27',18,'A',1,1,'Maths','T1','Active'),
                (2,'2026-27',18,'A',1,3,'English','T2','Active'),
                (3,'2026-27',18,'A',2,3,'Science','UNKNOWN','Active'),
                (4,'2026-27',19,'A',1,1,'Other class','T1','Active'),
                (5,'2026-27',18,'B',1,1,'Other section','T1','Active'),
                (6,'2026-27',18,'A',3,1,'Inactive slot','T1','Inactive'),
                (7,'2026-27',18,'A',1,0,'Not a lesson','T1','Active');
        """)

        @asynccontextmanager
        async def connection():
            yield self.connection

        self.patch = patch.object(main, "get_connection", connection)
        self.patch.start()
        app = FastAPI()
        app.include_router(create_student_timetable_router(connection, main.fetch_current_student_record))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.patch.stop()
        await self.connection.close()

    async def test_real_reader_uses_student_scope_and_admin_periods(self):
        response = await self.client.get("/timetable", params={"email": "student@gmail.com"})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["academic_year"], "2026-27")
        self.assertEqual(len(data["periods"]), 4)
        self.assertEqual(data["periods"][0]["start_time"], "09:00:00")
        self.assertEqual([s["subject_name"] for s in data["days"][0]["slots"]], ["Maths", "English"])
        self.assertEqual(data["days"][0]["slots"][0]["teacher_name"], "Maths Teacher")
        self.assertIsNone(data["days"][1]["slots"][0]["teacher_name"])
        self.assertEqual(data["days"][2]["slots"], [])
        self.assertEqual(len(data["days"]), 6)

    async def test_half_day_does_not_include_slots_outside_its_periods(self):
        response = await self.client.get("/timetable", params={"email": "student@gmail.com", "schedule_type": "half"})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(len(data["periods"]), 1)
        self.assertEqual(data["periods"][0]["start_time"], "08:00:00")
        self.assertEqual(len(data["days"][0]["slots"]), 1)
        self.assertEqual(data["days"][1]["slots"], [])

    async def test_other_class_and_missing_student_are_rejected(self):
        response = await self.client.get("/timetable", params={"email": "student@gmail.com", "class_id": 19})
        self.assertEqual(response.status_code, 403)
        response = await self.client.get("/timetable", params={"email": "missing@gmail.com"})
        self.assertEqual(response.status_code, 404)
