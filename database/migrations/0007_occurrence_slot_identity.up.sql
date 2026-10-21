-- A timetable entry may be rescheduled to a second time slot on the same day
-- after an occurrence has already been generated. Keep each distinct time
-- range as its own attendance occurrence while making repeat ticks idempotent.
ALTER TABLE class_occurrences
    DROP INDEX uq_occurrences_entry_date,
    ADD UNIQUE KEY uq_occurrences_entry_date_slot
        (timetable_entry_id, class_date, scheduled_start, scheduled_end);
