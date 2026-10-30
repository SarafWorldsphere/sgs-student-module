"""Student timetable read contract and access scope; no external services."""
from contextlib import asynccontextmanager
from datetime import time
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import psycopg
from student_timetable import create_student_timetable_router
from timetable_config import load_tables


class TimetableTests(unittest.TestCase):
    def setUp(self):
        self.student = {"student_id": 1, "full_name": "Test Student", "class_id": 18, "class_name": "Class 8", "section": "A"}
        self.fetch_student = AsyncMock(side_effect=lambda email: self.student)
        self.cursor = SimpleNamespace(
            execute=AsyncMock(),
            fetchone=AsyncMock(return_value={"academic_year": "2026-27", "section_name": "A"}),
            fetchall=AsyncMock(),
        )
        self.periods = [
            {"period_id": 1, "period_no": 0, "period_label": "Assembly", "start_time": time(9), "end_time": time(9, 15), "is_teaching": False},
            {"period_id": 2, "period_no": 1, "period_label": "Period 1", "start_time": time(9, 15), "end_time": time(10), "is_teaching": True},
            {"period_id": 3, "period_no": 2, "period_label": "Period 2", "start_time": time(10), "end_time": time(10, 40), "is_teaching": True},
        ]
        self.set_results()

        @asynccontextmanager
        async def cursor(**kwargs):
            yield self.cursor

        @asynccontextmanager
        async def connection():
            yield SimpleNamespace(cursor=cursor)

        app = FastAPI()
        app.include_router(create_student_timetable_router(connection, self.fetch_student))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def set_results(self, years=None, periods=None, slots=None):
        self.cursor.fetchall.side_effect = [
            [{"academic_year": value} for value in (years if years is not None else ["2026-27"])],
            [{"schedule_type": "full"}, {"schedule_type": "half"}],
            periods if periods is not None else self.periods,
            slots if slots is not None else [
                {"timetable_id": 1, "day_of_week": 1, "period_no": 1, "subject_name": "Maths", "teacher_id": "T1", "teacher_name": "Teacher One"},
                {"timetable_id": 2, "day_of_week": 1, "period_no": 0, "subject_name": "Must not become a lesson", "teacher_id": None, "teacher_name": None},
            ],
        ]

    def get(self, **params):
        return self.client.get("/timetable", params={"email": "student@example.com", **params})

    def test_six_days_include_break_headers_but_only_teaching_slots(self):
        response = self.get()
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual([d["day_name"] for d in data["days"]], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
        self.assertFalse(data["periods"][0]["is_teaching"])
        self.assertEqual(data["periods"][1]["start_time"], "09:15:00")
        self.assertEqual(len(data["days"][0]["slots"]), 1)
        self.assertEqual(data["days"][1]["slots"], [])
        self.assertTrue(data["has_slots"])

    def test_other_class_is_denied_before_timetable_query(self):
        self.assertEqual(self.get(class_id=99).status_code, 403)
        self.cursor.execute.assert_not_awaited()

    def test_other_section_is_denied(self):
        self.assertEqual(self.get(section="B").status_code, 403)
        self.assertEqual(self.cursor.execute.await_count, 1)

    def test_section_match_normalizes_case_and_whitespace(self):
        self.assertEqual(self.get(section=" a ").status_code, 200)

    def test_scope_and_schedule_are_bound_parameters(self):
        self.assertEqual(self.get(schedule_type="half").status_code, 200)
        calls = self.cursor.execute.await_args_list
        self.assertEqual(calls[3].args[1], ("2026-27", "half"))
        self.assertEqual(calls[4].args[1], ("2026-27", 18, "A"))
        self.assertIn('"sgs_timetable"', calls[4].args[0])
        self.assertIn("record_status", calls[4].args[0])

    def test_unknown_year_is_not_silently_replaced(self):
        self.assertEqual(self.get(academic_year="1990-91").status_code, 404)

    def test_unassigned_class_or_section_is_explicit(self):
        self.student["class_id"] = None
        self.assertEqual(self.get().status_code, 409)
        self.student["class_id"] = 18
        self.student["section"] = None
        self.cursor.fetchone.return_value = {"academic_year": "2026-27", "section_name": None}
        self.assertEqual(self.get().status_code, 409)

    def test_class_section_is_used_when_student_section_is_missing(self):
        self.student["section"] = None
        self.assertEqual(self.get().json()["section"], "A")

    def test_periods_without_slots_are_not_fabricated(self):
        self.set_results(slots=[])
        data = self.get().json()
        self.assertFalse(data["has_slots"])
        self.assertEqual(len(data["periods"]), 3)
        self.assertTrue(all(day["slots"] == [] for day in data["days"]))

    def test_empty_configuration_returns_empty_week(self):
        self.set_results(years=[], periods=[], slots=[])
        data = self.get().json()
        self.assertIsNone(data["academic_year"])
        self.assertEqual(data["periods"], [])
        self.assertEqual(len(data["days"]), 6)

    def test_database_failure_is_not_reported_as_empty_schedule(self):
        self.cursor.execute.side_effect = psycopg.errors.UndefinedTable("missing")
        self.assertEqual(self.get().status_code, 503)

    def test_identity_and_input_are_required(self):
        self.assertEqual(self.client.get("/timetable").status_code, 422)
        self.assertEqual(self.get(schedule_type="bad;sql").status_code, 422)


class ConfigurationTests(unittest.TestCase):
    def test_all_timetable_names_live_in_json(self):
        names = json.loads((Path(__file__).resolve().parents[1] / "timetable_tables.json").read_text())
        self.assertEqual(set(names), {"classes", "periods", "timetable", "teachers"})
        self.assertEqual(load_tables().periods, '"sgs_period_master"')


if __name__ == "__main__":
    unittest.main()
