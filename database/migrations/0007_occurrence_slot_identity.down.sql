-- Rollback is only possible while there is at most one slot per timetable
-- entry and date; otherwise duplicate-key validation will reject this change.
ALTER TABLE class_occurrences
    DROP INDEX uq_occurrences_entry_date_slot,
    ADD UNIQUE KEY uq_occurrences_entry_date (timetable_entry_id, class_date);
