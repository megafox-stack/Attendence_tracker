-- Rollback for migration 0003. This permanently removes occurrence and audit data.
-- Only use before storing real user data, or after a verified backup and explicit approval.
DROP TABLE attendance_changes;
DROP TABLE class_occurrences;
