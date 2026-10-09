CREATE TABLE IF NOT EXISTS sgs_student_notification_status (
    notification_status_id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES sgs_student_master(student_id),
    notification_type VARCHAR(30) NOT NULL,
    source_id BIGINT NOT NULL,
    first_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT uq_student_notification_status UNIQUE (student_id, notification_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_student_notification_status_unread
    ON sgs_student_notification_status (student_id, read_at);

COMMENT ON TABLE sgs_student_notification_status IS
    'Stores read state per student for notice, assignment, and result notifications.';
