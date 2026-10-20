-- Destructive rollback: only use before real data exists or after a verified backup.
DROP TABLE attendance_changes;
DROP TABLE class_occurrences;
