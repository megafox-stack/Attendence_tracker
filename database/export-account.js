import 'dotenv/config';
import mysql from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATUSES = { pending: 'Pending', present: 'Present', absent: 'Absent', cancelled: 'Cancelled' };
const email = process.argv[2]?.trim();
const outputPath = process.argv[3];

function dateOnly(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function epoch(value) { return value == null ? null : new Date(value).getTime(); }
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; configure the existing local database connection first.`);
  return value;
}

async function main() {
  if (!email || !outputPath) throw new Error('Usage: node database/export-account.js <account-email> <output.json>');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'), password: required('DB_PASSWORD'), database: process.env.DB_NAME || 'attendance_tracker',
    timezone: 'Z', charset: 'utf8mb4', dateStrings: false,
  });
  try {
    const [[user]] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (!user) throw new Error('No account matches that email address.');
    const userId = user.id;
    const [[semesterRows], [subjectRows], [entryRows], [holidayRows], [occurrenceRows], [changeRows], [schedulerRows]] = await Promise.all([
      connection.execute('SELECT id, name, start_date, end_date, working_days_mask, attendance_target_percent, status, time_zone FROM semesters WHERE user_id = ? ORDER BY start_date, id', [userId]),
      connection.execute('SELECT id, semester_id, name, code, attendance_target_percent, is_active FROM subjects WHERE user_id = ? ORDER BY semester_id, name, code', [userId]),
      connection.execute('SELECT id, semester_id, subject_id, day_of_week, start_time, end_time, room, effective_from, effective_until, is_active FROM timetable_entries WHERE user_id = ? ORDER BY semester_id, day_of_week, start_time, id', [userId]),
      connection.execute('SELECT id, semester_id, event_date, reason FROM calendar_events WHERE user_id = ? ORDER BY semester_id, event_date', [userId]),
      connection.execute('SELECT id, semester_id, timetable_entry_id, subject_id, class_date, scheduled_start, scheduled_end, subject_name_snapshot, subject_code_snapshot, room_snapshot, status, generated_at, finalized_at FROM class_occurrences WHERE user_id = ? ORDER BY class_date, scheduled_start, id', [userId]),
      connection.execute('SELECT id, class_occurrence_id, actor_type, old_status, new_status, reason, changed_at FROM attendance_changes WHERE user_id = ? ORDER BY changed_at, id', [userId]),
      connection.execute('SELECT enabled, last_run_at, last_run_date, last_error FROM scheduler_settings WHERE user_id = ? LIMIT 1', [userId]),
    ]);

    const latestReason = new Map();
    for (const change of changeRows) if (change.reason) latestReason.set(String(change.class_occurrence_id), change.reason);
    const timetableEntries = entryRows.map((row) => ({ id: String(row.id), semesterId: String(row.semester_id), subjectId: String(row.subject_id), day: DAYS[Number(row.day_of_week) - 1], start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5), room: row.room, effectiveFrom: dateOnly(row.effective_from), effectiveUntil: dateOnly(row.effective_until), active: Boolean(row.is_active) }));
    const entryById = new Map(timetableEntries.map((entry) => [entry.id, entry]));
    const seenEntryDate = new Set();
    const occurrences = occurrenceRows.map((row) => {
      const originalEntryId = String(row.timetable_entry_id);
      let timetableEntryId = originalEntryId;
      const occurrenceDate = dateOnly(row.class_date);
      const uniqueKey = `${originalEntryId}|${occurrenceDate}`;
      if (seenEntryDate.has(uniqueKey)) {
        // The former MySQL schema permitted multiple time slots per recurring entry/date.
        // Preserve each old record using an inactive, hidden one-date alias so the Room
        // unique (entry,date) rule remains strict for all user-visible timetable entries.
        timetableEntryId = `legacy-history-${String(row.id)}`;
        const parent = entryById.get(originalEntryId);
        if (!parent) throw new Error(`Attendance record ${row.id} points to a missing timetable entry.`);
        timetableEntries.push({ ...parent, id: timetableEntryId, day: DAYS[new Date(`${occurrenceDate}T00:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${occurrenceDate}T00:00:00Z`).getUTCDay() - 1], start: String(row.scheduled_start).slice(0, 5), end: String(row.scheduled_end).slice(0, 5), room: row.room_snapshot, effectiveFrom: occurrenceDate, effectiveUntil: occurrenceDate, active: false, historicalOnly: true });
      }
      seenEntryDate.add(uniqueKey);
      return { id: String(row.id), semesterId: String(row.semester_id), timetableEntryId, subjectId: String(row.subject_id), date: occurrenceDate, start: String(row.scheduled_start).slice(0, 5), end: String(row.scheduled_end).slice(0, 5), subject: row.subject_name_snapshot, code: row.subject_code_snapshot, room: row.room_snapshot, status: STATUSES[row.status], note: latestReason.get(String(row.id)) || null, generatedAt: epoch(row.generated_at), finalizedAt: epoch(row.finalized_at) };
    });
    const scheduler = schedulerRows[0];
    const data = {
      semesters: semesterRows.map((row) => ({ id: String(row.id), name: row.name, startDate: dateOnly(row.start_date), endDate: dateOnly(row.end_date), workingDays: DAYS.filter((_day, i) => (Number(row.working_days_mask || 0) & (1 << i)) !== 0), attendanceTargetPercent: row.attendance_target_percent == null ? null : Number(row.attendance_target_percent), status: row.status, timeZone: row.time_zone })),
      subjects: subjectRows.map((row) => ({ id: String(row.id), semesterId: String(row.semester_id), name: row.name, code: row.code, attendanceTargetPercent: row.attendance_target_percent == null ? null : Number(row.attendance_target_percent), active: Boolean(row.is_active) })),
      timetableEntries,
      holidays: holidayRows.map((row) => ({ id: String(row.id), semesterId: String(row.semester_id), date: dateOnly(row.event_date), reason: row.reason })),
      occurrences,
      attendanceChanges: changeRows.map((row) => ({ id: String(row.id), occurrenceId: String(row.class_occurrence_id), actorType: row.actor_type, oldStatus: STATUSES[row.old_status], newStatus: STATUSES[row.new_status], reason: row.reason, changedAt: epoch(row.changed_at) })),
      settings: scheduler ? [
        { key: 'schedulerEnabled', value: String(Boolean(scheduler.enabled)) },
        ...(scheduler.last_run_at ? [{ key: 'schedulerLastRunAt', value: new Date(scheduler.last_run_at).toISOString() }] : []),
        ...(scheduler.last_run_date ? [{ key: 'schedulerLastRunDate', value: dateOnly(scheduler.last_run_date) }] : []),
        ...(scheduler.last_error ? [{ key: 'schedulerLastError', value: scheduler.last_error }] : []),
      ] : [],
    };
    const backup = { format: 'attendance-tracker-backup', version: 1, exportedAt: new Date().toISOString(), data };
    const target = resolve(outputPath);
    await writeFile(target, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' });
    console.log(`Exported ${subjectRows.length} subject(s), ${entryRows.length} timetable entry/entries, ${occurrenceRows.length} attendance record(s), and ${holidayRows.length} holiday(s) to ${target}`);
  } finally { await connection.end(); }
}

main().catch((error) => { console.error(`Account export failed: ${error.message}`); process.exitCode = 1; });
