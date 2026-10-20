-- Removing this column discards saved weekly working-day selections.
ALTER TABLE semesters DROP CHECK chk_semesters_working_days_mask;
ALTER TABLE semesters DROP COLUMN working_days_mask;
