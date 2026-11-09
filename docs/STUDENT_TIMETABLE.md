# Student timetable (SaaS)

This feature reads the schedule maintained by the Admin dashboard. Students do
not create or edit slots. The admin's bulk `PUT /api/timetable` and teacher-clash
validation remain owned by the Admin service.

## UI

- Open **Timetable** in the sidebar (`/timetable`, or `/student/timetable` when
  deployed with `NEXT_PUBLIC_BASE_PATH=/student`).
- Class and section are taken from the current student's profile. Academic year
  and full/half-day timing sets come from the database, with the class's year
  preferred by default.
- Desktop shows Monday–Saturday as a horizontally scrollable week. Mobile shows
  day tabs and a chronological list. Period order and times come from the admin's
  period table, not hardcoded times or assumed period numbers.
- Assembly and breaks appear as non-teaching periods. Empty teaching cells show
  **Free period**; no fake lesson records are generated. If no slots are saved,
  the page explains that the class timetable has not been published yet.
- Loading, missing class/section, unavailable login, API failures, and empty
  schedules have separate states. Refresh reloads the latest saved schedule.

## API

The backend adds `GET /timetable`. The frontend uses the existing
`NEXT_PUBLIC_API_BASE_URL`; for staging's `/api` proxy this becomes
`GET /api/timetable?email=<session identity>`.

Optional query parameters: `academic_year`, `schedule_type` (default `full`),
`class_id`, and `section`. If class/section are supplied, they must match the
resolved student's profile; another class or section returns 403. A missing
student returns 404, and an unassigned class/section returns 409.

The result includes:

- `student`, `section`, selected `academic_year` and `schedule_type`;
- available `academic_years` and `schedule_types`;
- `periods`: ordered timings including assembly/breaks;
- `days`: Monday–Saturday entries with `day_of_week`, `day_name`, and `slots`;
- slots contain period number, subject and teacher details. Free periods are
  absent from `slots`; break periods never receive teaching slots.

The canonical SaaS period/slot tables have no `record_status` field. Teacher
lookup accepts numeric or string IDs. Query values remain bound parameters.
Every read uses the existing tenant-bound database connection and RLS context.

## Configuration and rollout

`backend/timetable_tables.json` names the canonical unprefixed tables:
`period_master`, `timetable`, `class_master`, `teacher_master`. Names are validated
and quoted by `timetable_config.py`. Never point this SaaS reader at staging's
`sgs_` tables. The existing pool and tenant-kit apply the resolved school's RLS
context; this route does not create a separate pool or accept a tenant ID.
The deployment owner must provision tenant-protected timetable tables before
rollout; a missing relation returns 503 instead of a fabricated empty schedule.

Use the existing student backend environment and dependency setup. No database
migration, period seeding, copied admin schedule, or live data change is needed.
If the admin has not saved any timetable rows, the student view correctly remains
unpublished even when period timings already exist.

The existing login-service integration is reused, including credentialed requests.
This feature does not bypass or replace backend authentication. The previously
reported deployed API authentication issue needs its own verified fix; successful
dashboard navigation alone does not prove that authenticated data calls work.

## Validation

```bash
python -B -m unittest discover -s backend/tests -v
npm run build
```

Optional real-SQL tests use `TIMETABLE_TEST_DATABASE_URL` pointing only to a local
database named `student_timetable_test`. They create connection-local temporary
tables and verify real student lookup, class/section scoping, teacher resolution, full/half-day timings, breaks, and omitted free slots.
No staging/production test database is permitted.

On this SaaS branch, `test_timetable_saas.py` additionally creates a disposable
schema and restricted role in that local database. It tests the real pooled
connection and kit RLS binding with two schools sharing the same email, class,
student and teacher IDs. It verifies nine periods, teacher joins, connection
reuse, unknown-host rejection and that a browser tenant header cannot change
the school selected by its host. The fixtures and test role are removed after
each test. The local test administrator must be allowed to create test roles.
