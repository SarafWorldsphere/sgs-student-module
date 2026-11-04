"""Academic marks for learning-material tracks; never infer reading speed."""
import json
import math
from pathlib import Path
import re
from types import SimpleNamespace

from fastapi import HTTPException
import psycopg
from psycopg.rows import dict_row
from psycopg.sql import Identifier

CATEGORIES = ("pt1_marks", "pt2_marks", "weekly_test_marks", "quiz_score", "assignment_marks")
LABELS = {"pt1_marks": "PT1", "pt2_marks": "PT2", "weekly_test_marks": "Weekly test", "quiz_score": "Quiz", "assignment_marks": "Assignment"}
CONFIG_PATH = Path(__file__).with_name("performance_config.json")


def load_config(path=CONFIG_PATH):
    with Path(path).open(encoding="utf-8") as file:
        config = json.load(file)
    if set(config["tables"]) != {"marks", "exams", "assessments", "assessment_results", "assignments", "quizzes"}:
        raise ValueError("Performance table configuration is incomplete.")
    for key, value in config["tables"].items():
        parts = value.split(".")
        if len(parts) not in (1, 2) or any(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", part) is None for part in parts):
            raise ValueError(f"Invalid table identifier: {key}")
    if not 0 <= config["average_reader_minimum"] < config["fast_reader_minimum"] <= 100:
        raise ValueError("Reader thresholds must be ordered percentages.")
    if set(config["direct_component_maxima"]) != set(CATEGORIES[:3]):
        raise ValueError("PT1, PT2 and weekly-test grading scales must be configured explicitly.")
    for maximum in config["direct_component_maxima"].values():
        if maximum is not None and (not isinstance(maximum, (int, float)) or not math.isfinite(maximum) or maximum <= 0):
            raise ValueError("Configured maximum marks must be positive.")
    return config


CONFIG = load_config()
TABLES = SimpleNamespace(**{key: Identifier(*name.split(".")).as_string() for key, name in CONFIG["tables"].items()})


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def percent(value=None, maximum=None, recorded_percentage=None):
    recorded = number(recorded_percentage)
    if recorded is not None:
        return recorded if 0 <= recorded <= 100 else None
    value, maximum = number(value), number(maximum)
    if value is None or maximum is None or maximum <= 0 or not 0 <= value <= maximum:
        return None
    return value / maximum * 100


def academic_category(*labels):
    text = " ".join(str(label or "") for label in labels).lower()
    if re.search(r"\b(?:pt|periodic[\s_-]*test)[\s_-]*1\b", text):
        return "pt1_marks"
    if re.search(r"\b(?:pt|periodic[\s_-]*test)[\s_-]*2\b", text):
        return "pt2_marks"
    if re.search(r"\bweekly(?:[\s_-]*test)?\b|\bweek[\s_-]*\d+[\s_-]*test\b", text):
        return "weekly_test_marks"
    return None


def marks_classification(metrics, config=CONFIG):
    available = [number(metrics.get(key)) for key in CATEGORIES]
    available = [value for value in available if value is not None and 0 <= value <= 100]
    if not available:
        return None, None
    score = sum(available) / len(available)
    classification = "Fast Reader" if score >= config["fast_reader_minimum"] else "Average Reader" if score >= config["average_reader_minimum"] else "Slow Reader"
    return classification, round(score, 2)


def summarize_rows(student_id, mark_rows, assessment_rows, assignment_rows, quiz_rows, config=CONFIG):
    direct = {key: [] for key in CATEGORIES[:3]}
    named = {key: [] for key in CATEGORIES[:3]}
    assessments = {key: [] for key in CATEGORIES}
    unconfigured = set()
    for row in mark_rows:
        for key, column in zip(CATEGORIES[:3], ("pt1", "pt2", "weekly_test")):
            if row.get(column) is not None:
                maximum = config["direct_component_maxima"][key]
                if maximum is None:
                    unconfigured.add(LABELS[key])
                value = percent(row.get(column), maximum)
                if value is not None:
                    direct[key].append(value)
        category = academic_category(row.get("exam_name"), row.get("exam_type"))
        value = percent(row.get("marks_obtained"), row.get("max_marks"))
        if category and value is not None:
            named[category].append(value)
    for row in assessment_rows:
        category = academic_category(row.get("exam_name"), row.get("title"))
        if not category:
            category = {"quiz": "quiz_score", "assignment": "assignment_marks"}.get(str(row.get("assessment_type", "")).lower())
        value = percent(row.get("marks_obtained"), row.get("max_marks"), row.get("percentage"))
        if category and value is not None:
            assessments[category].append(value)
    assignments = [percent(row.get("marks_obtained"), row.get("total_marks"), row.get("percentage")) for row in assignment_rows]
    quizzes = [percent(row.get("score"), row.get("total_marks"), row.get("percentage")) for row in quiz_rows]
    groups = {key: direct[key] or named[key] or assessments[key] for key in CATEGORIES[:3]}
    groups["assignment_marks"] = [v for v in assignments if v is not None] or assessments["assignment_marks"]
    groups["quiz_score"] = [v for v in quizzes if v is not None] or assessments["quiz_score"]
    metrics = {key: round(sum(values) / len(values), 2) if values else None for key, values in groups.items()}
    classification, score = marks_classification(metrics, config)
    return {"student_id": student_id, **metrics, "classification": classification, "overall_score": score,
            "available_categories": [LABELS[key] for key in CATEGORIES if metrics[key] is not None],
            "component_counts": {key: len(values) for key, values in groups.items()},
            "grading_scale_needed": sorted(unconfigured),
            "classification_rule": {"average_minimum": config["average_reader_minimum"], "fast_minimum": config["fast_reader_minimum"], "weighting": "equal average of available category percentages"}}


async def calculate_marks_summary(student_id, get_connection):
    queries = [
        f"""SELECT marks.pt1, marks.pt2, marks.weekly_test, marks.marks_obtained, marks.max_marks,
                   exam.exam_name, exam.exam_type
            FROM {TABLES.marks} marks LEFT JOIN {TABLES.exams} exam ON exam.exam_id=marks.exam_id
            WHERE marks.student_id=%s AND UPPER(COALESCE(marks.record_status,'Active'))='ACTIVE'
              AND (exam.exam_id IS NULL OR UPPER(COALESCE(exam.record_status,'Active'))='ACTIVE')""",
        f"""SELECT result.marks_obtained, result.percentage, assessment.max_marks,
                   assessment.title, assessment.assessment_type, exam.exam_name
            FROM {TABLES.assessment_results} result
            JOIN {TABLES.assessments} assessment ON assessment.assessment_id=result.assessment_id
            LEFT JOIN {TABLES.exams} exam ON exam.exam_id=assessment.exam_id
            WHERE result.student_id=%s AND NOT COALESCE(result.is_absent,false)
              AND UPPER(COALESCE(result.record_status,'Active'))='ACTIVE'
              AND UPPER(COALESCE(assessment.record_status,'Active'))='ACTIVE'
              AND (exam.exam_id IS NULL OR UPPER(COALESCE(exam.record_status,'Active'))='ACTIVE')""",
        f"""SELECT marks_obtained,total_marks,percentage FROM {TABLES.assignments}
            WHERE student_id=%s AND UPPER(COALESCE(record_status,'ACTIVE'))='ACTIVE'""",
        f"""SELECT score,total_marks,percentage FROM {TABLES.quizzes}
            WHERE student_id=%s AND COALESCE(completed_flag,false)
              AND UPPER(COALESCE(record_status,'Active'))='ACTIVE'""",
    ]
    try:
        async with get_connection() as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                rows = []
                for query in queries:
                    await cursor.execute(query, (student_id,))
                    rows.append(await cursor.fetchall())
    except psycopg.Error as error:
        raise HTTPException(503, "Unable to load assessment marks. Please try again later.") from error
    return summarize_rows(student_id, *rows)
