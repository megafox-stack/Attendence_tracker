-- Attendance Tracker — migration 0003
-- Requires migrations 0001 and 0002 and MySQL 8.0.16+.
-- The unique source/date key is the scheduler's duplicate-safe boundary.

CREATE TABLE class_occurrences (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    semester_id BIGINT UNSIGNED NOT NULL,
    timetable_entry_id BIGINT UNSIGNED NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    class_date DATE NOT NULL COMMENT 'Local date in the semester time zone.',
    scheduled_start TIME NOT NULL COMMENT 'Snapshot of local wall-clock start time.',
    scheduled_end TIME NOT NULL COMMENT 'Snapshot of local wall-clock end time.',
    subject_name_snapshot VARCHAR(160) NOT NULL,
    subject_code_snapshot VARCHAR(40) NOT NULL,
    room_snapshot VARCHAR(120) NULL,
    status ENUM('pending', 'present', 'absent', 'cancelled') NOT NULL DEFAULT 'pending',
    generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    finalized_at DATETIME(3) NULL COMMENT 'UTC; set for Present, Absent, or Cancelled.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    UNIQUE KEY uq_occurrences_entry_date (timetable_entry_id, class_date),
    UNIQUE KEY uq_occurrences_id_user (id, user_id),
    KEY ix_occurrences_daily_review (user_id, class_date, scheduled_start),
    KEY ix_occurrences_subject_history (subject_id, class_date),
    KEY ix_occurrences_semester_date (semester_id, class_date),
    CONSTRAINT fk_occurrences_timetable_entry_owner
        FOREIGN KEY (timetable_entry_id, semester_id, user_id)
        REFERENCES timetable_entries (id, semester_id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_occurrences_subject_owner
        FOREIGN KEY (subject_id, semester_id, user_id)
        REFERENCES subjects (id, semester_id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_occurrences_time_order CHECK (scheduled_end > scheduled_start),
    CONSTRAINT chk_occurrences_snapshot_name CHECK (CHAR_LENGTH(TRIM(subject_name_snapshot)) > 0),
    CONSTRAINT chk_occurrences_snapshot_code CHECK (CHAR_LENGTH(TRIM(subject_code_snapshot)) > 0),
    CONSTRAINT chk_occurrences_finalized_at CHECK (
        (status = 'pending' AND finalized_at IS NULL) OR
        (status <> 'pending' AND finalized_at IS NOT NULL)
    )
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attendance_changes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL COMMENT 'Owner of the occurrence; derived from authenticated context.',
    class_occurrence_id BIGINT UNSIGNED NOT NULL,
    actor_type ENUM('user', 'system') NOT NULL,
    old_status ENUM('pending', 'present', 'absent', 'cancelled') NOT NULL,
    new_status ENUM('pending', 'present', 'absent', 'cancelled') NOT NULL,
    reason VARCHAR(500) NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    KEY ix_attendance_changes_occurrence_time (class_occurrence_id, changed_at),
    KEY ix_attendance_changes_user_time (user_id, changed_at),
    CONSTRAINT fk_attendance_changes_occurrence_owner
        FOREIGN KEY (class_occurrence_id, user_id)
        REFERENCES class_occurrences (id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_attendance_changes_status_changed CHECK (old_status <> new_status),
    CONSTRAINT chk_attendance_changes_reason_nonempty CHECK (
        reason IS NULL OR CHAR_LENGTH(TRIM(reason)) > 0
    )
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
