-- Rollback for migration 0002. This permanently removes timetable and holiday data.
-- Only use before storing real user data, or after a verified backup and explicit approval.
DROP TABLE calendar_events;
DROP TABLE timetable_entries;
ALTER TABLE subjects
    DROP INDEX uq_subjects_id_semester_user;
