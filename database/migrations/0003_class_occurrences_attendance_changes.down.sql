<<<<<<< HEAD
-- Rollback for migration 0003. This permanently removes occurrence and audit data.
-- Only use before storing real user data, or after a verified backup and explicit approval.
=======
-- Destructive rollback: only use before real data exists or after a verified backup.
>>>>>>> database
DROP TABLE attendance_changes;
DROP TABLE class_occurrences;
