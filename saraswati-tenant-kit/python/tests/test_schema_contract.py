"""The table files are the contract: every school table carries tenant_id and an index that leads with it."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"

EXPECTED_PUBLIC_TABLES = {
    "roles",
    "users_masters",
    "otp_verifications",
    "class_master",
    "subject_master",
    "chapter_master",
    "chapter_content",
    "exam_master",
    "teacher_master",
    "student_master",
    "parent_master",
    "parent_student_map",
    "teacher_class_subject_map",
    "assignment_master",
    "assignment_results",
    "student_submission",
    "quiz_master",
    "quiz_response",
    "assessments",
    "assessment_results",
    "student_marks",
    "student_learning_profiles",
    "teacher_notes",
    "teacher_lesson_plans",
    "question_papers",
    "notice_board",
    "function_master",
    "tour_master",
    "help_support",
    "support_tickets",
    "ticket_messages",
    "student_notification_status",
    "file_storage_metadata",
    "ai_usage_logs",
}


def _sql() -> str:
    return "\n".join(path.read_text() for path in sorted(SRC.glob("*.sql")))


def _create_blocks(sql: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    current = None
    chunk: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("CREATE TABLE "):
            if current is not None:
                blocks[current] = "\n".join(chunk)
            name = stripped.split("CREATE TABLE ", 1)[1].split("(")[0].strip()
            name = name.split(".")[-1]
            current = name
            chunk = [line]
            if stripped.endswith(";"):
                blocks[current] = "\n".join(chunk)
                current = None
                chunk = []
            continue
        if current is not None:
            chunk.append(line)
            if stripped.endswith(");"):
                blocks[current] = "\n".join(chunk)
                current = None
                chunk = []
    return blocks


def test_every_school_table_is_defined_once():
    blocks = _create_blocks(_sql())
    public = {name for name in blocks if name not in {"tenants", "tenant_domains"}}
    assert public == EXPECTED_PUBLIC_TABLES


def test_school_tables_have_tenant_id_and_a_leading_index():
    sql = _sql()
    blocks = _create_blocks(sql)
    for name in EXPECTED_PUBLIC_TABLES:
        body = blocks[name]
        assert "tenant_id" in body, name
        assert f"UNIQUE (tenant_id" in body or "UNIQUE (tenant_id," in body, name
        assert f"REFERENCES platform.tenants (tenant_id)" in body, name
    assert "CREATE INDEX" in sql or "CREATE UNIQUE INDEX" in sql


def test_control_plane_is_not_a_school_table():
    blocks = _create_blocks(_sql())
    assert "slug" in blocks["tenants"]
    assert "database_secret" in blocks["tenants"]
    assert "domain" in blocks["tenant_domains"]
    migration = (ROOT / "migrations" / "0001_row_level_security.sql").read_text()
    assert "nspname = 'public'" in migration


def test_rls_migration_runs_after_the_table_files():
    migration = (ROOT / "migrations" / "0001_row_level_security.sql").read_text()
    assert "CREATE POLICY tenant_isolation" in migration
    assert "platform.current_tenant_id()" in migration
    assert "stamp_tenant_id" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    src = _sql().lower()
    assert "create policy" not in src
