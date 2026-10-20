-- Rollback for migration 0001. This permanently removes these tables and their data.
-- Only use before storing real user data, or after a verified backup and explicit approval.
DROP TABLE subjects;
DROP TABLE semesters;
DROP TABLE users;
