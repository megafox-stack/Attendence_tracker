<<<<<<< HEAD
-- Attendance Tracker — migration 0001
-- Requires MySQL 8.0.16+ (enforced CHECK constraints and utf8mb4_0900 collations).
-- Run through the migration runner selected by the backend; do not edit after deployment.

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    password_hash VARCHAR(255) NOT NULL COMMENT 'Password hash only; never store plaintext passwords.',
    display_name VARCHAR(120) NULL,
    time_zone VARCHAR(64) NOT NULL COMMENT 'IANA time-zone name; validated by the API.',
    email_verified_at DATETIME(3) NULL COMMENT 'UTC.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
=======
-- Attendance Tracker — migration 0001; MySQL 8.0.16+.
CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    password_hash VARCHAR(255) NOT NULL COMMENT 'Password hash only; never plaintext.',
    display_name VARCHAR(120) NULL,
    time_zone VARCHAR(64) NOT NULL COMMENT 'Validated IANA time-zone name.',
    email_verified_at DATETIME(3) NULL COMMENT 'UTC.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
>>>>>>> database
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT chk_users_email_nonempty CHECK (CHAR_LENGTH(TRIM(email)) > 0),
    CONSTRAINT chk_users_timezone_nonempty CHECK (CHAR_LENGTH(TRIM(time_zone)) > 0)
<<<<<<< HEAD
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
=======
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
>>>>>>> database

CREATE TABLE semesters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
<<<<<<< HEAD
    start_date DATE NOT NULL COMMENT 'Inclusive academic calendar date.',
    end_date DATE NOT NULL COMMENT 'Inclusive academic calendar date.',
    time_zone VARCHAR(64) NOT NULL COMMENT 'IANA time zone used to interpret class times.',
    attendance_target_percent DECIMAL(5,2) NULL,
    status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
    active_slot TINYINT GENERATED ALWAYS AS (
        CASE WHEN status = 'active' THEN 1 ELSE NULL END
    ) STORED COMMENT 'Unique per user while active; NULL allows multiple draft/archived semesters.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
=======
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    time_zone VARCHAR(64) NOT NULL COMMENT 'IANA time zone for local class times.',
    attendance_target_percent DECIMAL(5,2) NULL,
    status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
    active_slot TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
>>>>>>> database
    PRIMARY KEY (id),
    UNIQUE KEY uq_semesters_id_user (id, user_id),
    UNIQUE KEY uq_semesters_one_active_per_user (user_id, active_slot),
    KEY ix_semesters_user_status_start (user_id, status, start_date),
<<<<<<< HEAD
    CONSTRAINT fk_semesters_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_semesters_date_order CHECK (end_date >= start_date),
    CONSTRAINT chk_semesters_target_range CHECK (
        attendance_target_percent IS NULL OR
        attendance_target_percent BETWEEN 0.00 AND 100.00
    ),
    CONSTRAINT chk_semesters_name_nonempty CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_semesters_timezone_nonempty CHECK (CHAR_LENGTH(TRIM(time_zone)) > 0)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
=======
    CONSTRAINT fk_semesters_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_semesters_date_order CHECK (end_date >= start_date),
    CONSTRAINT chk_semesters_target_range CHECK (attendance_target_percent IS NULL OR attendance_target_percent BETWEEN 0.00 AND 100.00),
    CONSTRAINT chk_semesters_name_nonempty CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_semesters_timezone_nonempty CHECK (CHAR_LENGTH(TRIM(time_zone)) > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
>>>>>>> database

CREATE TABLE subjects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    semester_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(160) NOT NULL,
    code VARCHAR(40) NOT NULL,
<<<<<<< HEAD
    attendance_target_percent DECIMAL(5,2) NULL
        COMMENT 'If NULL, the API resolves the semester default for display.',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    UNIQUE KEY uq_subjects_semester_code (semester_id, code),
    KEY ix_subjects_user_semester_active (user_id, semester_id, is_active),
    CONSTRAINT fk_subjects_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_subjects_semester_owner
        FOREIGN KEY (semester_id, user_id) REFERENCES semesters (id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_subjects_target_range CHECK (
        attendance_target_percent IS NULL OR
        attendance_target_percent BETWEEN 0.00 AND 100.00
    ),
    CONSTRAINT chk_subjects_name_nonempty CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_subjects_code_nonempty CHECK (CHAR_LENGTH(TRIM(code)) > 0)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
=======
    attendance_target_percent DECIMAL(5,2) NULL COMMENT 'NULL means use semester target for display.',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (id),
    UNIQUE KEY uq_subjects_semester_code (semester_id, code),
    KEY ix_subjects_user_semester_active (user_id, semester_id, is_active),
    CONSTRAINT fk_subjects_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_subjects_semester_owner FOREIGN KEY (semester_id, user_id) REFERENCES semesters (id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_subjects_target_range CHECK (attendance_target_percent IS NULL OR attendance_target_percent BETWEEN 0.00 AND 100.00),
    CONSTRAINT chk_subjects_name_nonempty CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_subjects_code_nonempty CHECK (CHAR_LENGTH(TRIM(code)) > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
>>>>>>> database
