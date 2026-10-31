<<<<<<< HEAD
-- Rollback for migration 0001. This permanently removes these tables and their data.
-- Only use before storing real user data, or after a verified backup and explicit approval.
=======
-- Destructive rollback: only use before real data exists or after a verified backup.
>>>>>>> database
DROP TABLE subjects;
DROP TABLE semesters;
DROP TABLE users;
