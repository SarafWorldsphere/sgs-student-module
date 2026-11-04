"""Read the admin's timetable for the current student's class and section."""
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query
import psycopg
from psycopg.rows import dict_row

from timetable_config import tables

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


def create_student_timetable_router(get_connection: Callable, fetch_student: Callable):
    router = APIRouter()

    @router.get("/timetable")
    async def get_timetable(
        email: str = Query(..., min_length=3, max_length=150),
        academic_year: str | None = Query(None, min_length=1, max_length=30),
        schedule_type: str = Query("full", pattern=r"^[A-Za-z0-9_-]{1,30}$"),
        class_id: int | None = Query(None, ge=1),
        section: str | None = Query(None, min_length=1, max_length=20),
    ):
        student = await fetch_student(email)
        student_class = student.get("class_id")
        if not student_class:
            raise HTTPException(409, "A class has not been assigned to your student profile yet.")
        if class_id is not None and class_id != student_class:
            raise HTTPException(403, "You can only view your own class timetable.")
        try:
            async with get_connection() as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        f"SELECT academic_year, section_name FROM {tables.classes} WHERE class_id = %s",
                        (student_class,),
                    )
                    school_class = await cursor.fetchone() or {}
                    student_section = str(student.get("section") or school_class.get("section_name") or "").strip()
                    if not student_section:
                        raise HTTPException(409, "A section has not been assigned to your student profile yet.")
                    if section is not None and section.strip().casefold() != student_section.casefold():
                        raise HTTPException(403, "You can only view your own section timetable.")
                    await cursor.execute(
                        f"""
                        SELECT academic_year FROM {tables.periods}
                        WHERE NULLIF(BTRIM(academic_year), '') IS NOT NULL
                          AND COALESCE(record_status, 'Active') = 'Active'
                        UNION
                        SELECT academic_year FROM {tables.timetable}
                        WHERE class_id = %s AND LOWER(BTRIM(section)) = LOWER(%s)
                          AND NULLIF(BTRIM(academic_year), '') IS NOT NULL
                          AND COALESCE(record_status, 'Active') = 'Active'
                        ORDER BY academic_year DESC
                        """,
                        (student_class, student_section),
                    )
                    years = [row["academic_year"] for row in await cursor.fetchall()]
                    class_year = school_class.get("academic_year")
                    year = academic_year or (class_year if class_year in years else None) or next(iter(years), None)
                    if academic_year is not None and academic_year not in years:
                        raise HTTPException(404, "The timetable for this academic year is not available.")
                    await cursor.execute(
                        f"""SELECT DISTINCT schedule_type FROM {tables.periods}
                        WHERE academic_year = %s AND NULLIF(BTRIM(schedule_type), '') IS NOT NULL
                          AND COALESCE(record_status, 'Active') = 'Active'
                        ORDER BY schedule_type""", (year,),
                    )
                    schedule_types = [row["schedule_type"] for row in await cursor.fetchall()]
                    await cursor.execute(
                        f"""SELECT period_id, period_no, period_label, start_time, end_time, is_teaching
                        FROM {tables.periods}
                        WHERE academic_year = %s AND schedule_type = %s
                          AND COALESCE(record_status, 'Active') = 'Active'
                        ORDER BY start_time, period_no""", (year, schedule_type),
                    )
                    periods = await cursor.fetchall()
                    await cursor.execute(
                        f"""SELECT slot.timetable_id, slot.day_of_week, slot.period_no,
                                   slot.subject_name, slot.teacher_id, teacher.full_name AS teacher_name
                        FROM {tables.timetable} slot
                        LEFT JOIN {tables.teachers} teacher
                          ON teacher.teacher_id::text = slot.teacher_id::text
                        WHERE slot.academic_year = %s AND slot.class_id = %s
                          AND LOWER(BTRIM(slot.section)) = LOWER(%s)
                          AND slot.day_of_week BETWEEN 1 AND 6
                          AND COALESCE(slot.record_status, 'Active') = 'Active'
                        ORDER BY slot.day_of_week, slot.period_no, slot.timetable_id""",
                        (year, student_class, student_section),
                    )
                    slots = await cursor.fetchall()
        except psycopg.errors.UndefinedTable as error:
            raise HTTPException(503, "The timetable is not available yet. Please try again later.") from error
        except psycopg.Error as error:
            raise HTTPException(503, "Unable to load your timetable. Please try again.") from error

        teaching_periods = {period["period_no"] for period in periods if period["is_teaching"]}
        days = [{"day_of_week": number, "day_name": name, "slots": []} for number, name in enumerate(DAYS, 1)]
        for slot in slots:
            if slot["period_no"] in teaching_periods:
                days[slot["day_of_week"] - 1]["slots"].append(slot)
        has_slots = any(day["slots"] for day in days)
        return {
            "student": {key: student.get(key) for key in ("student_id", "full_name", "class_id", "class_name")},
            "section": student_section,
            "academic_year": year,
            "academic_years": years,
            "schedule_type": schedule_type,
            "schedule_types": schedule_types,
            "periods": periods,
            "days": days,
            "has_slots": has_slots,
            "message": None if has_slots else "Your class timetable has not been published yet.",
        }

    return router
