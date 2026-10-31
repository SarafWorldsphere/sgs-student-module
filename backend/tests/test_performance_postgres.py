"""Optional real SQL verification using temporary tables on local PostgreSQL."""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg.conninfo import conninfo_to_dict
from performance_summary import calculate_marks_summary

URL = os.environ.get("PERFORMANCE_TEST_DATABASE_URL", "")
if URL and sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@unittest.skipUnless(URL, "Set PERFORMANCE_TEST_DATABASE_URL to opt into local SQL tests")
class MarksPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        details = conninfo_to_dict(URL)
        if details.get("host") not in ("localhost", "127.0.0.1") or details.get("dbname") != "student_learning_path_test":
            raise RuntimeError("Marks SQL tests require disposable local student_learning_path_test.")
        self.connection = await psycopg.AsyncConnection.connect(URL)
        await self.connection.execute("""
            CREATE TEMP TABLE sgs_exam_master (exam_id bigint,exam_name text,exam_type text,record_status text);
            CREATE TEMP TABLE sgs_student_marks (student_id bigint,exam_id bigint,pt1 numeric,pt2 numeric,weekly_test numeric,
                marks_obtained numeric,max_marks numeric,record_status text);
            CREATE TEMP TABLE sgs_assessments (assessment_id bigint,title text,assessment_type text,max_marks numeric,exam_id bigint,record_status text);
            CREATE TEMP TABLE sgs_assessment_results (student_id bigint,assessment_id bigint,marks_obtained numeric,percentage numeric,is_absent boolean,record_status text);
            CREATE TEMP TABLE sgs_assignment_results (student_id bigint,marks_obtained numeric,total_marks numeric,percentage numeric,record_status text);
            CREATE TEMP TABLE sgs_quiz_response (student_id bigint,score numeric,total_marks numeric,percentage numeric,completed_flag boolean,record_status text);
            INSERT INTO sgs_exam_master VALUES (1,'PT-1','Periodic Test','Active'),(2,'PT-2','Periodic Test','Active'),(3,'Weekly Test','Test','Active');
            INSERT INTO sgs_student_marks VALUES (1,1,NULL,NULL,NULL,16,20,'Active'),(1,1,NULL,NULL,NULL,0,20,'Inactive'),(2,1,NULL,NULL,NULL,0,20,'Active');
            INSERT INTO sgs_assessments VALUES (1,'PT-2 Maths','test',20,2,'Active'),(2,'Weekly test','test',10,3,'Active'),(3,'Unit test','test',100,NULL,'Active'),(4,'PT-1 duplicate source','test',100,1,'Active');
            INSERT INTO sgs_assessment_results VALUES (1,1,14,NULL,false,'Active'),(1,2,6,NULL,false,'Active'),(1,1,0,NULL,true,'Active'),(1,3,0,NULL,false,'Active'),(1,4,0,NULL,false,'Active');
            INSERT INTO sgs_assignment_results VALUES (1,10,20,NULL,'ACTIVE'),(1,NULL,20,NULL,'ACTIVE'),(1,0,20,NULL,'Inactive'),(2,0,20,NULL,'ACTIVE');
            INSERT INTO sgs_quiz_response VALUES (1,8,10,NULL,true,'Active'),(1,0,10,NULL,false,'Active'),(1,0,10,NULL,true,'Inactive');
        """)

        @asynccontextmanager
        async def connection():
            yield self.connection

        self.get_connection = connection

    async def asyncTearDown(self):
        await self.connection.close()

    async def test_all_five_categories_read_real_marks_without_duplicate_fallbacks(self):
        result = await calculate_marks_summary(1, self.get_connection)
        self.assertEqual([result[key] for key in ("pt1_marks","pt2_marks","weekly_test_marks","quiz_score","assignment_marks")], [80,70,60,80,50])
        self.assertEqual(result["overall_score"],68)
        self.assertEqual(result["classification"],"Average Reader")
        self.assertEqual(set(result["component_counts"].values()),{1})

    async def test_other_student_keeps_zero_without_inheriting_marks(self):
        result = await calculate_marks_summary(2, self.get_connection)
        self.assertEqual(result["pt1_marks"],0)
        self.assertEqual(result["assignment_marks"],0)
        self.assertIsNone(result["quiz_score"])
        self.assertEqual(result["classification"],"Slow Reader")

    async def test_missing_student_marks_do_not_become_zero(self):
        result = await calculate_marks_summary(999, self.get_connection)
        self.assertIsNone(result["classification"])
        self.assertIsNone(result["overall_score"])
