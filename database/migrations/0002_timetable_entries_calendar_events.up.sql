-- Attendance Tracker — migration 0002
-- Requires migration 0001 and MySQL 8.0.16+.
-- Cross-row date-range and overlap rules are enforced by the API in transactions.

-- Candidate key used by the entry's composite subject ownership foreign key.
ALTER TABLE subjects
    ADD UNIQUE KEY uq_subjects_id_semester_user (id, semester_id, user_id);

CREATE TABLE timetable_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    semester_id BIGINT UNSIGNED NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    day_of_week TINYINT UNSIGNED NOT NULL COMMENT 'ISO weekday: Monday=1 through Sunday=7.',
    start_time TIME NOT NULL COMMENT 'Local wall-clock time in semester time zone.',
    end_time TIME NOT NULL COMMENT 'Same-day end; classes cannot cross midnight.',
    room VARCHAR(120) NULL,
    effective_from DATE NOT NULL COMMENT 'Inclusive recurring date range.',
    effective_until DATE NOT NULL COMMENT 'Inclusive recurring date range.',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    UNIQUE KEY uq_timetable_entries_id_semester_user (id, semester_id, user_id),
    KEY ix_timetable_entries_weekly (semester_id, day_of_week, is_active, start_time),
    KEY ix_timetable_entries_user_active (user_id, is_active),
    CONSTRAINT fk_timetable_entries_semester_owner
        FOREIGN KEY (semester_id, user_id) REFERENCES semesters (id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_timetable_entries_subject_owner
        FOREIGN KEY (subject_id, semester_id, user_id)
        REFERENCES subjects (id, semester_id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_timetable_entries_day CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT chk_timetable_entries_time_order CHECK (end_time > start_time),
    CONSTRAINT chk_timetable_entries_date_order CHECK (effective_until >= effective_from)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE calendar_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    semester_id BIGINT UNSIGNED NOT NULL,
    event_date DATE NOT NULL COMMENT 'Local calendar date in the semester time zone.',
    type ENUM('holiday') NOT NULL DEFAULT 'holiday',
    reason VARCHAR(240) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    UNIQUE KEY uq_calendar_events_semester_date_type (semester_id, event_date, type),
    KEY ix_calendar_events_user_date (user_id, event_date),
    CONSTRAINT fk_calendar_events_semester_owner
        FOREIGN KEY (semester_id, user_id) REFERENCES semesters (id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
