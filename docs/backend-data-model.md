# Attendance Tracker backend data model

**Status:** Initial schema proposal; migrations 0001–0003 implement the core user, semester, subject, timetable, calendar, and attendance tables  
**Scope:** Database schema only. This document does not create or connect to a database server.

## Design goals

- Every user's timetable, attendance, and calendar data belongs to that user.
- A weekly timetable is a recurring rule. A class occurrence is a dated instance generated from that rule.
- Scheduler retries cannot create duplicate occurrences.
- Timetable edits and scheduler retries never overwrite finalized attendance.
- A holiday is a calendar event, not an attendance status.
- Attendance percentages use only Present and Absent records.
- Store timestamps in UTC and represent academic dates and scheduled times in the semester's configured time zone.

## Entities

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | Internal identifier |
| `email` | VARCHAR(254), unique, not null | Email login; normalize to lowercase |
| `password_hash` | VARCHAR(255), not null | Store a password hash only; never plaintext |
| `display_name` | VARCHAR(120), nullable | A neutral greeting is used until this exists |
| `time_zone` | VARCHAR(64), not null | IANA name; require during account setup, no inferred default |
| `email_verified_at` | DATETIME(3), nullable | UTC; null until verified |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Authentication secrets or external identity provider identifiers should be managed with the selected authentication approach; do not store plaintext passwords.

### `semesters`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | |
| `user_id` | BIGINT UNSIGNED, foreign key → `users.id` | Ownership boundary |
| `name` | VARCHAR(120), not null | User-provided semester label |
| `start_date`, `end_date` | DATE, not null | Inclusive; end must be on/after start |
| `time_zone` | VARCHAR(64), not null | IANA time zone used to interpret class times |
| `attendance_target_percent` | DECIMAL(5,2), nullable | Range 0–100; semester default |
| `status` | ENUM(`draft`, `active`, `archived`), not null | A generated nullable unique-key column enforces one active semester per user |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Index: (`user_id`, `status`, `start_date`).

### `subjects`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | |
| `user_id` | BIGINT UNSIGNED, foreign key → `users.id` | Enforce ownership in API queries |
| `semester_id` | BIGINT UNSIGNED, foreign key → `semesters.id` | Subject belongs to one semester |
| `name` | VARCHAR(160), not null | |
| `code` | VARCHAR(40), not null | |
| `attendance_target_percent` | DECIMAL(5,2), nullable | If null, use the semester target for display |
| `is_active` | BOOLEAN, not null, default TRUE | Deactivation preserves historical records |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Unique key: (`semester_id`, `code`) under a case-insensitive collation. Normalize code whitespace in the API. A composite foreign key also enforces that the subject's user owns its semester.

### `timetable_entries`

A row describes a recurring weekly class, not a specific date.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | Stable source for generated occurrences |
| `user_id` | BIGINT UNSIGNED, foreign key → `users.id` | |
| `semester_id` | BIGINT UNSIGNED, foreign key → `semesters.id` | |
| `subject_id` | BIGINT UNSIGNED, foreign key → `subjects.id` | Must belong to the same user and semester |
| `day_of_week` | TINYINT UNSIGNED, not null | ISO weekday: Monday=1 … Sunday=7 |
| `start_time`, `end_time` | TIME, not null | Local wall-clock time in semester time zone; end > start |
| `room` | VARCHAR(120), nullable | Room/lab |
| `effective_from`, `effective_until` | DATE, not null | Inclusive recurrence date range, constrained to semester |
| `is_active` | BOOLEAN, not null, default TRUE | Inactive entries do not generate future occurrences |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Indexes: (`semester_id`, `day_of_week`, `is_active`, `start_time`), (`user_id`, `is_active`). Composite foreign keys ensure the subject, semester, and entry have the same owner. The API must validate that the effective date range falls within the semester. Reject overlapping active entries for the same semester/day unless an explicit product rule later allows them. MySQL cannot express this time-range exclusion as a simple unique key, so lock the semester row and validate overlaps inside a transaction when creating or editing an entry.

### `calendar_events`

Initially this stores holidays. It is separate from attendance status so it cannot be mistaken for an attendance record.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | |
| `user_id` | BIGINT UNSIGNED, foreign key → `users.id` | |
| `semester_id` | BIGINT UNSIGNED, foreign key → `semesters.id` | |
| `event_date` | DATE, not null | Local calendar date |
| `type` | ENUM(`holiday`), not null | Extend only when calendar behavior is defined |
| `reason` | VARCHAR(240), nullable | |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Unique key: (`semester_id`, `event_date`, `type`). A holiday suppresses scheduled occurrences for that date. It does not delete timetable entries or historical occurrences. The API must ensure the event date falls within the semester range.

### `class_occurrences`

A dated instance of a timetable entry. This is the record the scheduler generates and the user reviews.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | |
| `user_id` | BIGINT UNSIGNED, foreign key → `users.id` | Ownership checked on every read/write |
| `semester_id` | BIGINT UNSIGNED, foreign key → `semesters.id` | |
| `timetable_entry_id` | BIGINT UNSIGNED, not null, foreign key → `timetable_entries.id` | Occurrences are created from recurring timetable entries; source entries are deactivated, not deleted |
| `subject_id` | BIGINT UNSIGNED, not null, foreign key → `subjects.id` | Subjects are deactivated, not deleted |
| `class_date` | DATE, not null | Local date in semester time zone |
| `scheduled_start`, `scheduled_end` | TIME, not null | Snapshot from timetable when generated |
| `subject_name_snapshot`, `subject_code_snapshot` | VARCHAR(160)/VARCHAR(40), not null | Preserve readable history after subject edits/deactivation |
| `room_snapshot` | VARCHAR(120), nullable | Preserve the scheduled room at generation time |
| `status` | ENUM(`pending`, `present`, `absent`, `cancelled`), not null, default `pending` | Holiday is not a status |
| `generated_at` | DATETIME(3), not null | UTC scheduler creation time |
| `finalized_at` | DATETIME(3), nullable | UTC; null only for Pending; set for Present, Absent, or Cancelled |
| `created_at`, `updated_at` | DATETIME(3), not null | UTC |

Required unique key: (`timetable_entry_id`, `class_date`). This is the idempotency boundary for scheduler retries. Migration 0003 also adds (`user_id`, `class_date`) for daily review and (`subject_id`, `class_date`) for history/summary queries. Composite foreign keys enforce that the source entry and subject belong to the occurrence's user and semester.

If occurrences can be created without a timetable entry in a future product flow, define a separate deterministic occurrence key before supporting that flow; do not weaken duplicate protection.

### `attendance_changes` (audit log)

Append-only record of each accepted attendance correction or cancellation.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED, primary key | |
| `user_id` | BIGINT UNSIGNED | Owner of the occurrence; comes from authenticated context |
| `class_occurrence_id` | BIGINT UNSIGNED, foreign key → `class_occurrences.id` | Composite foreign key enforces matching owner |
| `actor_type` | ENUM(`user`, `system`) | Distinguishes user corrections from system actions, such as a holiday cancellation |
| `old_status` | ENUM(`pending`, `present`, `absent`, `cancelled`), not null | Initial Pending generation is recorded on the occurrence, not as a change |
| `new_status` | ENUM(`pending`, `present`, `absent`, `cancelled`), not null | |
| `reason` | VARCHAR(500), nullable | User's correction reason |
| `changed_at` | DATETIME(3), not null | UTC |

Do not update or delete prior audit rows during normal attendance correction. Migration 0003 rejects no-op status changes and prevents occurrence deletion while audit history exists.

## Relationship overview

```text
users ──< semesters ──< subjects
             │              │
             ├──< timetable_entries >──┘
             │          │
             ├──< calendar_events
             │
             └──< class_occurrences >── subjects (optional historical link)
                           │
                           └──< attendance_changes
```

All foreign-key relationships that cross a user-owned entity must be validated against the authenticated `user_id`; never trust a client-supplied owner ID.

## Attendance and scheduler invariants

1. Percentage = `Present / (Present + Absent) * 100`. Pending and Cancelled are excluded. If the denominator is zero, return no percentage.
2. Scheduler generation considers active semester dates, active timetable entries, and the semester time zone. It skips calendar holidays and dates outside each entry's effective range.
3. Generate Pending occurrences idempotently using (`timetable_entry_id`, `class_date`) uniqueness plus an insert-ignore/upsert strategy that **does not update status or finalized fields**.
4. The scheduler never infers Present or Absent from time. Only an explicit user correction or a separately verified process may finalize status.
5. Allowed user transitions are Pending/Present/Absent → any valid status, including Cancelled, subject to a recorded audit change. Cancelled is excluded from the Present/Absent denominator.
6. Bulk review runs in one transaction: validate ownership and every requested status, apply all changes, append audit rows, then commit. Any invalid item rolls back the entire bulk change.
7. A holiday is its own calendar event. When configured after occurrences already exist, mark affected, still-Pending occurrences Cancelled and audit the change. Do not alter Present/Absent occurrences; require an explicit, audited correction workflow for those.
8. Timetable edits affect future generation only. Existing occurrence snapshots and confirmed statuses remain unchanged. Deleting a recurring entry should deactivate it; retain its historical occurrences.
9. All API operations derive owner scope from authentication. A guessed or substituted record ID must not grant access to another user's data.

## Recommended implementation sequence

1. Email-based login is selected; store password hashes only and require an IANA time zone at account setup.
2. Users may have multiple semesters, but only one may be active; migration 0001 enforces this in MySQL.
3. Migration 0001 creates `users`, `semesters`, and `subjects`.
4. Migration 0002 creates timetable and calendar tables with database-enforced ownership relationships.
5. Migration 0003 creates class occurrences and attendance-change audit rows with retry and ownership constraints.
6. Implement authenticated CRUD and reads, then wire the existing frontend services.
7. Implement an idempotent occurrence-generation service; run it manually before adding a cloud scheduler.

## Decisions still needed

- Email login is selected. Password hashing parameters, verification delivery, and session/token strategy remain implementation decisions.
- Multiple semesters are allowed, with only one active semester per user; archiving behavior still needs definition.
- Recurring classes may not cross midnight in the initial model.
- Holidays apply to individual dates within a semester.
- Whether finalized Cancelled occurrences count toward a separate “finalized classes” UI count; they must not count in attendance percentage.
- Retention and export/deletion policy for user and attendance data.
