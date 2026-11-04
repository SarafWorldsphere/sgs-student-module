"""Marks-based material tracks, missing-data semantics and API consistency."""
from copy import deepcopy
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import main
from ai_learning_path_service import _focus_area, _path_prompt_rules, classify_performance
from performance_summary import CATEGORIES, CONFIG, academic_category, marks_classification, percent, summarize_rows


class MarksClassificationTests(unittest.TestCase):
    def test_threshold_boundaries(self):
        for score, expected in [(0, "Slow Reader"), (49.99, "Slow Reader"), (50, "Average Reader"), (74.99, "Average Reader"), (75, "Fast Reader"), (100, "Fast Reader")]:
            with self.subTest(score=score):
                self.assertEqual(marks_classification({key: score for key in CATEGORIES})[0], expected)

    def test_missing_categories_do_not_count_as_zero(self):
        result = summarize_rows(1, [], [], [], [{"percentage": 80}])
        self.assertEqual(result["classification"], "Fast Reader")
        self.assertEqual(result["overall_score"], 80)
        self.assertIsNone(result["assignment_marks"])
        self.assertEqual(result["available_categories"], ["Quiz"])

    def test_no_marks_does_not_assign_a_material_track(self):
        result = summarize_rows(1, [], [], [], [])
        self.assertIsNone(result["classification"])
        self.assertIsNone(result["overall_score"])

    def test_real_zero_remains_zero_not_missing(self):
        result = summarize_rows(1, [], [], [{"marks_obtained": 0, "total_marks": 20}], [])
        self.assertEqual(result["assignment_marks"], 0)
        self.assertEqual(result["classification"], "Slow Reader")

    def test_percentage_twenty_is_not_multiplied_by_five(self):
        self.assertEqual(percent(recorded_percentage=20), 20)
        self.assertEqual(percent(4, 20), 20)

    def test_categories_have_equal_weight_not_equal_record_count(self):
        result = summarize_rows(1, [], [], [{"percentage": 100}] * 12, [{"percentage": 0}])
        self.assertEqual(result["overall_score"], 50)
        self.assertEqual(result["classification"], "Average Reader")

    def test_named_exam_marks_use_recorded_maximum(self):
        result = summarize_rows(1, [{"exam_name": "PT-1", "marks_obtained": 16, "max_marks": 20}], [], [], [])
        self.assertEqual(result["pt1_marks"], 80)

    def test_direct_components_require_a_confirmed_scale(self):
        config = deepcopy(CONFIG)
        config["direct_component_maxima"] = {key: None for key in CATEGORIES[:3]}
        row = {"pt1": 16, "pt2": 20, "weekly_test": 5}
        result = summarize_rows(1, [row], [], [], [], config)
        self.assertIsNone(result["classification"])
        self.assertEqual(len(result["grading_scale_needed"]), 3)
        config["direct_component_maxima"] = {"pt1_marks": 20, "pt2_marks": 25, "weekly_test_marks": 10}
        result = summarize_rows(1, [row], [], [], [], config)
        self.assertEqual([result[key] for key in CATEGORIES[:3]], [80, 80, 50])
        self.assertEqual(result["overall_score"], 70)

    def test_named_sources_do_not_double_count_assessment_fallback(self):
        result = summarize_rows(1,
            [{"exam_name": "PT 1", "marks_obtained": 16, "max_marks": 20}],
            [{"title": "PT-1 Maths", "percentage": 10}], [], [])
        self.assertEqual(result["pt1_marks"], 80)
        self.assertEqual(result["component_counts"]["pt1_marks"], 1)

    def test_pt2_weekly_and_typed_assessment_fallbacks(self):
        rows = [{"title": "Periodic Test 2", "marks_obtained": 15, "max_marks": 20},
                {"title": "Weekly test - Science", "percentage": 60},
                {"assessment_type": "assignment", "percentage": 70},
                {"assessment_type": "quiz", "percentage": 90}]
        result = summarize_rows(1, [], rows, [], [])
        self.assertEqual([result[key] for key in CATEGORIES[1:]], [75, 60, 90, 70])

    def test_generic_exams_and_pt10_are_not_guessed_as_pt1(self):
        for label in ["PT10", "Half yearly", "Unit Test", "Quarterly"]:
            self.assertIsNone(academic_category(label))

    def test_invalid_marks_or_unknown_denominators_do_not_fabricate_scores(self):
        for value in [percent(-1, 20), percent(21, 20), percent(10, 0), percent(10, None), percent(recorded_percentage=101), percent(recorded_percentage=float('nan'))]:
            self.assertIsNone(value)

    def test_retries_and_old_unit_test_metric_do_not_change_track(self):
        for retries in [0, 1, 99]:
            self.assertEqual(classify_performance(80, 80, 0, retries, pt1_marks=80), "Fast Reader")

    def test_prompt_and_focus_do_not_treat_ungraded_work_as_failure(self):
        metrics = {"overall_score": 80, "quiz_score": 80, "assignment_marks": None}
        self.assertIn("Null means not graded", _path_prompt_rules(metrics))
        self.assertNotIn("assignment", _focus_area(metrics).lower())


class GenerationApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def test_generation_reads_db_marks_instead_of_trusting_browser_values(self):
        summary = summarize_rows(1, [], [], [], [{"percentage": 80}])
        generator = SimpleNamespace(generate_path=AsyncMock(return_value={"track_title": "Fast Reader Material"}))
        with patch.object(main, "calculate_performance_summary", AsyncMock(return_value=summary)), \
             patch.object(main, "fetch_student_email", AsyncMock(return_value="student@gmail.com")), \
             patch.object(main, "get_learning_path_generator", return_value=generator):
            response = self.client.post("/learning-path/generate-overall", json={"student_id": 1, "quiz_score": 0, "assignment_marks": 0})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["classification"], "Fast Reader")
        self.assertEqual(generator.generate_path.await_args.args[2]["quiz_score"], 80)
        self.assertEqual(response.json()["performance"], summary)

    def test_ungraded_student_does_not_call_ai(self):
        with patch.object(main, "calculate_performance_summary", AsyncMock(return_value=summarize_rows(1, [], [], [], []))), \
             patch.object(main, "get_learning_path_generator") as generator:
            response = self.client.post("/learning-path/generate-overall", json={"student_id": 1})
        self.assertEqual(response.status_code, 409)
        generator.assert_not_called()

    def test_study_content_uses_the_same_db_classification_as_the_path(self):
        summary = summarize_rows(1, [], [], [], [{"percentage": 80}])
        cursor = SimpleNamespace(execute=AsyncMock(), fetchone=AsyncMock(return_value={
            "chapter_content_id": 2, "content_title": "Motion", "full_text_content": "Speed is distance divided by time."}))

        @asynccontextmanager
        async def cursor_context(**kwargs):
            yield cursor

        @asynccontextmanager
        async def connection():
            yield SimpleNamespace(cursor=cursor_context)

        generated = AsyncMock(return_value={"simple_notes": ["Speed equals distance divided by time."]})
        with patch.object(main, "calculate_performance_summary", AsyncMock(return_value=summary)), \
             patch.object(main, "get_connection", connection), \
             patch.object(main, "fetch_student_email", AsyncMock(return_value="student@gmail.com")), \
             patch.object(main, "gemini_generate_json", generated):
            response = self.client.post("/ai/generate-study-content", json={"student_id": 1, "chapter_content_id": 2, "classification": "Slow Reader"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["classification"], "Fast Reader")
        self.assertIn("Learner type: Fast Reader", generated.await_args.args[0])
        self.assertEqual(response.json()["performance"], summary)
