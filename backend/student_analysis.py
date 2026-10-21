from collections.abc import Callable

import psycopg
from fastapi import APIRouter, HTTPException, Query
from psycopg.rows import dict_row


def create_student_analysis_router(
    get_connection: Callable,
    fetch_current_student_record: Callable,
) -> APIRouter:
    router = APIRouter()

    @router.get("/student-analysis")
    async def get_student_analysis(
        email: str = Query(..., min_length=3, max_length=150),
    ):
        student = await fetch_current_student_record(email)
        query = """
            SELECT
                assessment.title,
                assessment.assessment_date,
                assessment.max_marks,
                assessment.subject,
                result.marks_obtained,
                COALESCE(
                    result.percentage,
                    CASE
                        WHEN assessment.max_marks > 0
                        THEN ROUND(result.marks_obtained * 100 / assessment.max_marks, 2)
                        ELSE 0
                    END
                ) AS percentage
            FROM assessment_results result
            INNER JOIN assessments assessment
              ON assessment.assessment_id = result.assessment_id
            WHERE result.student_id = %s
              AND result.record_status = 'Active'
              AND assessment.record_status = 'Active'
              AND COALESCE(result.is_absent, false) = false
              AND NULLIF(BTRIM(assessment.subject), '') IS NOT NULL
            ORDER BY assessment.assessment_date, assessment.assessment_id;
        """

        try:
            async with get_connection() as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(query, (student["student_id"],))
                    rows = await cursor.fetchall()
        except psycopg.errors.UndefinedTable as error:
            raise HTTPException(status_code=500, detail="Assessment analysis tables are missing.") from error
        except psycopg.Error as error:
            raise HTTPException(status_code=500, detail="Unable to fetch student analysis.") from error

        subject_values: dict[str, list[float]] = {}
        test_groups: dict[tuple[str, str], dict] = {}
        all_percentages: list[float] = []

        for row in rows:
            subject = str(row["subject"]).strip()
            percentage = round(float(row["percentage"] or 0), 2)
            assessment_date = row["assessment_date"]
            date_value = assessment_date.isoformat() if assessment_date else ""
            title = str(row["title"] or "Assessment").strip()
            suffix = f" - {subject}"
            test_name = title[: -len(suffix)] if title.endswith(suffix) else title

            subject_values.setdefault(subject, []).append(percentage)
            group = test_groups.setdefault(
                (test_name, date_value),
                {
                    "test_name": test_name,
                    "assessment_date": date_value,
                    "subjects": [],
                    "percentages": [],
                },
            )
            group["subjects"].append(
                {
                    "subject": subject,
                    "marks_obtained": float(row["marks_obtained"] or 0),
                    "max_marks": float(row["max_marks"] or 0),
                    "percentage": percentage,
                }
            )
            group["percentages"].append(percentage)
            all_percentages.append(percentage)

        subject_performance = [
            {
                "subject": subject,
                "average_percentage": round(sum(values) / len(values), 2),
            }
            for subject, values in sorted(subject_values.items())
        ]

        detailed_tests = []
        timeline = []
        for group in test_groups.values():
            average = round(sum(group["percentages"]) / len(group["percentages"]), 2)
            detailed_tests.append(
                {
                    "test_name": group["test_name"],
                    "assessment_date": group["assessment_date"],
                    "average_percentage": average,
                    "subjects": sorted(group["subjects"], key=lambda item: item["subject"]),
                }
            )
            timeline.append(
                {
                    "label": group["test_name"],
                    "assessment_date": group["assessment_date"],
                    "average_percentage": average,
                }
            )

        focus_areas = []
        for item in sorted(subject_performance, key=lambda entry: entry["average_percentage"]):
            current = item["average_percentage"]
            focus_areas.append(
                {
                    "subject": item["subject"],
                    "current_percentage": current,
                    "target_percentage": round(min(100, max(85, current + 8)), 2),
                    "priority": "High" if current < 70 else "Medium" if current < 80 else "Maintain",
                }
            )

        dated_rows = [row for row in rows if row["assessment_date"]]
        academic_year = "2026-27"
        if dated_rows:
            start_year = min(row["assessment_date"] for row in dated_rows).year
            academic_year = f"{start_year}-{str(start_year + 1)[-2:]}"

        return {
            "student": {
                "student_id": student["student_id"],
                "full_name": student["full_name"],
                "student_email": student["student_email"],
                "class_id": student["class_id"],
                "section": student["section"],
                "roll_no": student["roll_no"],
                "admission_no": student["admission_no"],
            },
            "academic_year": academic_year,
            "overall_average": round(sum(all_percentages) / len(all_percentages), 2) if all_percentages else 0,
            "subject_performance": subject_performance,
            "timeline": timeline,
            "detailed_tests": detailed_tests,
            "focus_areas": focus_areas,
        }

    return router
