-- Attendance Tracker — migration 0005; requires migration 0001 and MySQL 8.0.16+.
-- ISO weekday bitmask: Monday=bit 0 through Sunday=bit 6.
ALTER TABLE semesters
    ADD COLUMN working_days_mask TINYINT UNSIGNED NULL
        COMMENT 'ISO weekdays bitmask: Monday=bit 0 through Sunday=bit 6.';

ALTER TABLE semesters
    ADD CONSTRAINT chk_semesters_working_days_mask CHECK (working_days_mask IS NULL OR working_days_mask BETWEEN 1 AND 127);
