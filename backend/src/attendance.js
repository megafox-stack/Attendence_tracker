import { Router } from 'express';
import { authenticateSession } from './auth.js';
import { HttpError } from './errors.js';
import { findCurrentSemester } from './semesters.js';

const statusToDb = new Map([['Pending', 'pending'], ['Present', 'present'], ['Absent', 'absent'], ['Cancelled', 'cancelled']]);
const statusFromDb = new Map([...statusToDb].map(([label, value]) => [value, label]));
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const validDate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function localToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function serializeOccurrence(row) {
  return {
    id: String(row.id),
    subjectId: String(row.subject_id),
    timetableEntryId: String(row.timetable_entry_id),
    date: typeof row.class_date === 'string' ? row.class_date.slice(0, 10) : row.class_date.toISOString().slice(0, 10),
    subject: row.subject_name_snapshot,
    code: row.subject_code_snapshot,
    start: String(row.scheduled_start).slice(0, 5),
    end: String(row.scheduled_end).slice(0, 5),
    room: row.room_snapshot,
    status: statusFromDb.get(row.status),
  };
}

function validateDateInput(value) {
  if (!validDate(value)) throw new HttpError(400, 'Choose a valid class date.', 'invalid_class_date');
  return value;
}

async function getCurrentSemesterForDate(pool, userId, date) {
  const semester = await findCurrentSemester(pool, userId);
  if (!semester) throw new HttpError(409, 'Set up a semester before loading attendance.', 'semester_required');
  const start = typeof semester.start_date === 'string' ? semester.start_date.slice(0, 10) : semester.start_date.toISOString().slice(0, 10);
  const end = typeof semester.end_date === 'string' ? semester.end_date.slice(0, 10) : semester.end_date.toISOString().slice(0, 10);
  if (date < start || date > end) throw new HttpError(400, 'The selected date is outside the current semester.', 'date_outside_semester');
  return semester;
}

async function loadDay(pool, userId, date) {
  const [rows] = await pool.execute(
    `SELECT id, subject_id, timetable_entry_id, class_date, scheduled_start, scheduled_end,
            subject_name_snapshot, subject_code_snapshot, room_snapshot, status
     FROM class_occurrences
     WHERE user_id = ? AND class_date = ?
     ORDER BY scheduled_start, id`,
    [userId, date],
  );
  return rows.map(serializeOccurrence);
}

function percentage(present, absent) {
  const denominator = Number(present) + Number(absent);
  return denominator ? Math.round((Number(present) / denominator) * 1000) / 10 : null;
}

async function getUserLocalDate(pool, userId) {
  const [rows] = await pool.execute('SELECT time_zone FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows[0] ? localToday(rows[0].time_zone) : localToday('UTC');
}

function serializeHistoryRow(row) {
  return {
    ...serializeOccurrence(row),
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).toISOString() : null,
  };
}

function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw new HttpError(400, 'Submit between 1 and 100 attendance changes.', 'invalid_changes');
  const ids = new Set();
  return changes.map((change) => {
    const id = typeof change?.id === 'string' || typeof change?.id === 'number' ? String(change.id) : '';
    if (!/^\d+$/.test(id) || ids.has(id)) throw new HttpError(400, 'Each attendance record must have one valid, unique ID.', 'invalid_occurrence_id');
    ids.add(id);
    const status = statusToDb.get(change.status);
    if (!status) throw new HttpError(400, 'Choose Pending, Present, Absent, or Cancelled.', 'invalid_attendance_status');
    const reason = typeof change.reason === 'string' ? change.reason.trim() : '';
    if (reason.length > 500) throw new HttpError(400, 'Correction reason must be 500 characters or fewer.', 'invalid_correction_reason');
    return { id, status, reason: reason || null };
  });
}

async function applyChanges(pool, userId, date, changes) {
  const list = validateChanges(changes);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const changedIds = [];
    for (const change of list) {
      const [rows] = await connection.execute(
        'SELECT id, status FROM class_occurrences WHERE id = ? AND user_id = ? AND class_date = ? LIMIT 1 FOR UPDATE',
        [change.id, userId, date],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, 'One or more attendance records do not belong to the selected date or account.', 'occurrence_not_found');
      if (current.status === change.status) continue;
      await connection.execute(
        'UPDATE class_occurrences SET status = ?, finalized_at = IF(? = \'pending\', NULL, CURRENT_TIMESTAMP(3)) WHERE id = ? AND user_id = ?',
        [change.status, change.status, change.id, userId],
      );
      await connection.execute(
        `INSERT INTO attendance_changes (user_id, class_occurrence_id, actor_type, old_status, new_status, reason)
         VALUES (?, ?, 'user', ?, ?, ?)`,
        [userId, change.id, current.status, change.status, change.reason],
      );
      changedIds.push(change.id);
    }
    await connection.commit();
    return { changed: changedIds.length, records: await loadDay(pool, userId, date) };
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { connection.release(); }
}

export function createAttendanceRouter(pool) {
  const router = Router();
  router.use((req, res, next) => authenticateSession(pool, req, res, next));

  router.get('/classes', async (req, res) => {
    const date = validateDateInput(req.query.date);
    const semester = await getCurrentSemesterForDate(pool, req.auth.userId, date);
    res.json({ date, records: await loadDay(pool, req.auth.userId, date), semester: { startDate: semester.start_date, endDate: semester.end_date, timeZone: semester.time_zone } });
  });

  // Summary and class rows are sourced only from saved occurrences.
  router.get('/dashboard', async (req, res) => {
    const [counts, date] = await Promise.all([
      pool.execute(
        `SELECT status, COUNT(*) AS count FROM class_occurrences WHERE user_id = ? GROUP BY status`,
        [req.auth.userId],
      ),
      getUserLocalDate(pool, req.auth.userId),
    ]);
    const totals = { Present: 0, Absent: 0, Pending: 0, Cancelled: 0 };
    for (const row of counts[0]) totals[statusFromDb.get(row.status)] = Number(row.count);
    const todayRecords = await loadDay(pool, req.auth.userId, date);
    const timeZoneRows = await pool.execute('SELECT time_zone FROM users WHERE id = ? LIMIT 1', [req.auth.userId]);
    const timeZone = timeZoneRows[0][0]?.time_zone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const nowMinutes = Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0);
    const nextClass = todayRecords.find((record) => {
      const endMinutes = Number(record.end.slice(0, 2)) * 60 + Number(record.end.slice(3, 5));
      return record.status !== 'Cancelled' && endMinutes > nowMinutes;
    }) || null;
    const finalized = totals.Present + totals.Absent + totals.Cancelled;
    res.json({
      date,
      summary: { ...totals, finalized, total: Object.values(totals).reduce((sum, count) => sum + count, 0), attendancePercent: percentage(totals.Present, totals.Absent) },
      todayRecords,
      nextClass,
    });
  });

  router.get('/subjects', async (req, res) => {
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) return res.json({ subjects: [] });
    const [rows] = await pool.execute(
      `SELECT s.id, s.name, s.code,
              COALESCE(s.attendance_target_percent, sem.attendance_target_percent) AS attendance_target_percent,
              SUM(c.status = 'present') AS present_count,
              SUM(c.status = 'absent') AS absent_count,
              SUM(c.status = 'pending') AS pending_count,
              SUM(c.status = 'cancelled') AS cancelled_count
       FROM subjects s JOIN semesters sem ON sem.id = s.semester_id AND sem.user_id = s.user_id
       LEFT JOIN class_occurrences c ON c.subject_id = s.id AND c.user_id = s.user_id
       WHERE s.user_id = ? AND s.semester_id = ? AND s.is_active = TRUE
       GROUP BY s.id, s.name, s.code, s.attendance_target_percent, sem.attendance_target_percent
       ORDER BY s.name, s.code`,
      [req.auth.userId, semester.id],
    );
    res.json({ subjects: rows.map((row) => {
      const present = Number(row.present_count || 0);
      const absent = Number(row.absent_count || 0);
      return {
        id: String(row.id), name: row.name, code: row.code,
        targetPercent: row.attendance_target_percent == null ? null : Number(row.attendance_target_percent),
        present, absent, pending: Number(row.pending_count || 0), cancelled: Number(row.cancelled_count || 0),
        attendancePercent: percentage(present, absent),
      };
    }) });
  });

  router.get('/history', async (req, res) => {
    const conditions = ['c.user_id = ?'];
    const parameters = [req.auth.userId];
    const from = req.query.from;
    const to = req.query.to;
    const status = req.query.status;
    const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
    if (from && !validDate(from)) throw new HttpError(400, 'Choose a valid start date.', 'invalid_from_date');
    if (to && !validDate(to)) throw new HttpError(400, 'Choose a valid end date.', 'invalid_to_date');
    if (from && to && from > to) throw new HttpError(400, 'Start date must be before end date.', 'invalid_date_range');
    if (from) { conditions.push('c.class_date >= ?'); parameters.push(from); }
    if (to) { conditions.push('c.class_date <= ?'); parameters.push(to); }
    if (status && status !== 'All statuses') {
      const dbStatus = statusToDb.get(status);
      if (!dbStatus) throw new HttpError(400, 'Choose a valid attendance status.', 'invalid_attendance_status');
      conditions.push('c.status = ?'); parameters.push(dbStatus);
    }
    if (subject) { conditions.push('(c.subject_name_snapshot LIKE ? OR c.subject_code_snapshot LIKE ?)'); parameters.push(`%${subject}%`, `%${subject}%`); }
    const [rows] = await pool.execute(
      `SELECT c.id, c.subject_id, c.timetable_entry_id, c.class_date, c.scheduled_start, c.scheduled_end,
              c.subject_name_snapshot, c.subject_code_snapshot, c.room_snapshot, c.status, c.finalized_at
       FROM class_occurrences c WHERE ${conditions.join(' AND ')}
       ORDER BY c.class_date DESC, c.scheduled_start DESC, c.id DESC LIMIT 500`,
      parameters,
    );
    res.json({ records: rows.map(serializeHistoryRow) });
  });

  router.get('/insights', async (req, res) => {
    const from = req.query.from;
    const to = req.query.to;
    if (from && !validDate(from)) throw new HttpError(400, 'Choose a valid start date.', 'invalid_from_date');
    if (to && !validDate(to)) throw new HttpError(400, 'Choose a valid end date.', 'invalid_to_date');
    if (from && to && from > to) throw new HttpError(400, 'Start date must be before end date.', 'invalid_date_range');
    const conditions = ['c.user_id = ?'];
    if (req.query.range && req.query.range !== 'semester') throw new HttpError(400, 'Choose a valid insights range.', 'invalid_insights_range');
    const parameters = [req.auth.userId];
    if (req.query.range === 'semester') {
      const semester = await findCurrentSemester(pool, req.auth.userId);
      if (!semester) conditions.push('1 = 0');
      else {
        conditions.push('c.class_date >= ?'); parameters.push(dateOnly(semester.start_date));
        conditions.push('c.class_date <= ?'); parameters.push(dateOnly(semester.end_date));
      }
    }
    if (from) { conditions.push('c.class_date >= ?'); parameters.push(from); }
    if (to) { conditions.push('c.class_date <= ?'); parameters.push(to); }
    const where = conditions.join(' AND ');
    const [countResult, trendResult, subjectResult] = await Promise.all([
      pool.execute(`SELECT c.status, COUNT(*) AS count FROM class_occurrences c WHERE ${where} GROUP BY c.status`, parameters),
      pool.execute(`SELECT c.class_date, SUM(c.status = 'present') AS present, SUM(c.status = 'absent') AS absent FROM class_occurrences c WHERE ${where} GROUP BY c.class_date ORDER BY c.class_date`, parameters),
      pool.execute(
        `SELECT s.id, s.name, s.code, COALESCE(s.attendance_target_percent, sem.attendance_target_percent) AS target_percent,
                SUM(c.status = 'present') AS present_count, SUM(c.status = 'absent') AS absent_count,
                SUM(c.status = 'pending') AS pending_count
         FROM class_occurrences c JOIN subjects s ON s.id = c.subject_id AND s.user_id = c.user_id
         JOIN semesters sem ON sem.id = c.semester_id AND sem.user_id = c.user_id
         WHERE ${where} GROUP BY s.id, s.name, s.code, s.attendance_target_percent, sem.attendance_target_percent ORDER BY s.name`,
        parameters,
      ),
    ]);
    const counts = { Present: 0, Absent: 0, Pending: 0, Cancelled: 0 };
    for (const row of countResult[0]) counts[statusFromDb.get(row.status)] = Number(row.count);
    const finalized = counts.Present + counts.Absent;
    res.json({
      summary: { ...counts, finalized, attendancePercent: percentage(counts.Present, counts.Absent) },
      trend: trendResult[0].map((row) => ({ date: typeof row.class_date === 'string' ? row.class_date.slice(0, 10) : row.class_date.toISOString().slice(0, 10), present: Number(row.present || 0), absent: Number(row.absent || 0) })),
      subjects: subjectResult[0].map((row) => {
        const present = Number(row.present_count || 0); const absent = Number(row.absent_count || 0);
        return { id: String(row.id), name: row.name, code: row.code, targetPercent: row.target_percent == null ? null : Number(row.target_percent), present, absent, pending: Number(row.pending_count || 0), attendancePercent: percentage(present, absent) };
      }),
    });
  });

  // This is an explicit, user-requested operation; it is not a background scheduler.
  router.post('/classes/generate', async (req, res) => {
    const date = validateDateInput(req.body?.date);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [semesters] = await connection.execute(
        `SELECT id, start_date, end_date, working_days_mask, time_zone
         FROM semesters WHERE user_id = ? AND status IN ('active', 'draft')
         ORDER BY (status = 'active') DESC, updated_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [req.auth.userId],
      );
      const semester = semesters[0];
      if (!semester) throw new HttpError(409, 'Set up a semester before preparing class records.', 'semester_required');
      const startDate = typeof semester.start_date === 'string' ? semester.start_date.slice(0, 10) : semester.start_date.toISOString().slice(0, 10);
      const endDate = typeof semester.end_date === 'string' ? semester.end_date.slice(0, 10) : semester.end_date.toISOString().slice(0, 10);
      if (date < startDate || date > endDate) throw new HttpError(400, 'The selected date is outside the current semester.', 'date_outside_semester');
      if (date < localToday(semester.time_zone)) throw new HttpError(400, 'Class records can only be prepared for today or a future date. Historical records are never inferred from the recurring timetable.', 'historical_generation_not_allowed');
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
      if (!(Number(semester.working_days_mask) & (1 << (weekday - 1)))) throw new HttpError(400, 'The selected date is not a configured working day.', 'not_a_working_day');
      const [holidays] = await connection.execute('SELECT id FROM calendar_events WHERE user_id = ? AND semester_id = ? AND event_date = ? AND type = \'holiday\' LIMIT 1', [req.auth.userId, semester.id, date]);
      if (holidays[0]) {
        await connection.commit();
        return res.json({ date, created: 0, skipped: 'holiday', records: await loadDay(pool, req.auth.userId, date) });
      }
      const [result] = await connection.execute(
        `INSERT INTO class_occurrences
           (user_id, semester_id, timetable_entry_id, subject_id, class_date, scheduled_start, scheduled_end,
            subject_name_snapshot, subject_code_snapshot, room_snapshot, status)
         SELECT t.user_id, t.semester_id, t.id, t.subject_id, ?, t.start_time, t.end_time,
                s.name, s.code, t.room, 'pending'
         FROM timetable_entries t
         JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id AND s.semester_id = t.semester_id
         WHERE t.user_id = ? AND t.semester_id = ? AND t.day_of_week = ? AND t.is_active = TRUE
           AND t.effective_from <= ? AND t.effective_until >= ?
         ON DUPLICATE KEY UPDATE id = id`,
        [date, req.auth.userId, semester.id, weekday, date, date],
      );
      await connection.commit();
      res.json({ date, created: result.affectedRows, skipped: null, records: await loadDay(pool, req.auth.userId, date) });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      throw error;
    } finally { connection.release(); }
  });

  router.patch('/classes/:id', async (req, res) => {
    const date = validateDateInput(req.body?.date);
    const result = await applyChanges(pool, req.auth.userId, date, [{ id: req.params.id, status: req.body?.status, reason: req.body?.reason }]);
    res.json(result);
  });

  router.post('/bulk', async (req, res) => {
    const date = validateDateInput(req.body?.date);
    res.json(await applyChanges(pool, req.auth.userId, date, req.body?.changes));
  });

  router.post('/daily-submission', async (req, res) => {
    const date = validateDateInput(req.body?.date);
    const result = await applyChanges(pool, req.auth.userId, date, req.body?.changes);
    res.json({ date, ...result, saved: true });
  });

  return router;
}
