# Saraswati tenant kit

Shared school resolution for the Saraswati portals. The school comes from the hostname. School rows are hidden by one Postgres policy. Files in S3 start with the school id. Screens read the school name and logo from `platform.tenants.config`.

## Apply order

`src/` is the table definitions and their indexes. `migrations/` runs after that. Do not run the migrations against an empty database before `src/`.

```bash
DATABASE_URL=postgresql://... ./scripts/apply.sh
```

The script applies `src/*.sql` in name order, then `migrations/*.sql`. PostgreSQL 14 or newer.

`migrations/0001_row_level_security.sql` installs `platform.current_tenant_id()`, the stamp trigger, and the `tenant_isolation` policy on every school table.

`migrations/0002_app_grants.sql` creates the `saraswati_app` role. Grant it to the existing login role. Do not connect the apps as a superuser.

```sql
GRANT saraswati_app TO swais_app_user;
ALTER ROLE swais_app_user NOSUPERUSER NOBYPASSRLS;
```

## What the apps call

Python, from this directory:

```bash
pip install "git+https://github.com/SarafWorldsphere/saraswati-tenant-kit.git@v1#subdirectory=python"
```

```python
from saraswati_tenant import (
    SchoolMiddleware,
    apply_rls,
    build_key,
    current_school,
    open_school_session,
    resolve_school,
)
```

`SchoolMiddleware` is the only code that reads `Host`. `resolve_school` looks up `platform.tenant_domains`. `open_school_session` either sets `app.tenant_id` for the shared database or connects to the school's own database when `isolation` is `database`.

Environment:

| Variable | Purpose |
| --- | --- |
| `SARASWATI_DATABASE_URL` | Shared database |
| `SARASWATI_CONTROL_DATABASE_URL` | Optional. Defaults to the shared database. Used for the domain lookup. |
| `SARASWATI_DATABASE_SECRETS` | `secret-name=postgresql://...` pairs, separated by `;`, for schools with their own database |
| `SARASWATI_POOL_MAX_SIZE` | Shared pool size. Default 10 |

JavaScript:

```bash
npm install github:SarafWorldsphere/saraswati-tenant-kit#v1
```

The package root is `js/`. Import `@saraswati/tenant-kit` (`TenantProvider`, `useSchool`, `SchoolBrand`, `loadSchoolConfig`).

`loadSchoolConfig` requests `https://{host}/public/tenant-config`. Set `SARASWATI_PUBLIC_PROTO=http` for local development.

## Tables

School tables are unprefixed and each has `tenant_id`. The pair `(tenant_id, id)` is unique, and foreign keys use that pair so a row cannot point at another school's parent row. Indexes that serve a filter lead with `tenant_id`.

| Area | Tables |
| --- | --- |
| Control plane | `platform.tenants`, `platform.tenant_domains` |
| Identity | `roles`, `users_masters`, `otp_verifications` |
| Academics | `class_master`, `subject_master`, `chapter_master`, `chapter_content`, `exam_master` |
| People | `teacher_master`, `student_master`, `parent_master`, `parent_student_map`, `teacher_class_subject_map` |
| Learning | `assignment_master`, `assignment_results`, `student_submission`, `quiz_master`, `quiz_response`, `assessments`, `assessment_results`, `student_marks`, `student_learning_profiles`, `teacher_notes`, `teacher_lesson_plans`, `question_papers` |
| School life | `notice_board`, `function_master`, `tour_master`, `help_support`, `support_tickets`, `ticket_messages`, `student_notification_status` |
| Files | `file_storage_metadata`, `ai_usage_logs` |

`platform` is not covered by the tenant policy. The app role can select it and cannot insert into it.

## Names that differ from the current databases

| Current column or table | Column in this kit |
| --- | --- |
| `sgs_*` / `sss_*` prefix | no prefix |
| `sss_student_master.name` | `student_master.full_name` |
| `sss_student_master.roll_number` | `student_master.roll_no` |
| `sss_users_master` | `users_masters` (`username` and `role` are kept for the headmaster app) |
| `school_id` on users and classes | `tenant_id` |

`student_master` also has `gender`, `class_name`, and `student_photo_key`, which the admin app writes today.
