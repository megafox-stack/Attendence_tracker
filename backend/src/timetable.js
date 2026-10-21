import { Router } from 'express';
import { authenticateSession } from './auth.js';
import { HttpError } from './errors.js';
import { findCurrentSemester, serializeSemester } from './semesters.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayNumber = new Map(DAYS.map((day, index) => [day, index + 1]));

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function serializeEntry(row) {
  return {
    id: String(row.id),
    subjectId: String(row.subject_id),
    subject: row.subject_name,
    code: row.subject_code,
    day: DAYS[Number(row.day_of_week) - 1],
    start: String(row.start_time).slice(0, 5),
    end: String(row.end_time).slice(0, 5),
    room: row.room,
    active: Boolean(row.is_active),
    effectiveFrom: dateOnly(row.effective_from),
    effectiveUntil: dateOnly(row.effective_until),
  };
}

function serializeHoliday(row) {
  return { id: String(row.id), date: dateOnly(row.event_date), reason: row.reason };
}

async function lockCurrentSemester(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT id, user_id, name, start_date, end_date, working_days_mask,
            attendance_target_percent, status, time_zone
     FROM semesters
     WHERE user_id = ? AND status IN ('active', 'draft')
     ORDER BY (status = 'active') DESC, updated_at DESC, id DESC
     LIMIT 1 FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new HttpError(409, 'Set up a semester before editing the timetable.', 'semester_required');
  return rows[0];
}

function parseEntry(body, semester) {
  const subjectId = typeof body.subjectId === 'string' || typeof body.subjectId === 'number' ? String(body.subjectId) : '';
  const day = typeof body.day === 'string' ? body.day : '';
  const start = typeof body.start === 'string' ? body.start : '';
  const end = typeof body.end === 'string' ? body.end : '';
  const room = typeof body.room === 'string' ? body.room.trim() : '';
  const active = body.active === undefined ? true : body.active;

  if (!/^\d+$/.test(subjectId)) throw new HttpError(400, 'Choose a subject from your current semester.', 'invalid_subject');
  if (!dayNumber.has(day)) throw new HttpError(400, 'Choose a valid weekday.', 'invalid_day');
  if (!semester.working_days_mask || !(Number(semester.working_days_mask) & (1 << (dayNumber.get(day) - 1)))) {
    throw new HttpError(400, 'This day is not enabled as a semester working day.', 'day_not_configured');
  }
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(start) || !timePattern.test(end) || end <= start) {
    throw new HttpError(400, 'Enter valid times; the end time must be later than the start time on the same day.', 'invalid_time_range');
  }
  if (room.length > 120) throw new HttpError(400, 'Room or laboratory must be 120 characters or fewer.', 'invalid_room');
  if (typeof active !== 'boolean') throw new HttpError(400, 'Class active status must be true or false.', 'invalid_active_status');
  return { subjectId, dayNumber: dayNumber.get(day), start, end, room: room || null, active };
}

async function ensureNoOverlap(connection, semesterId, day, start, end, exceptId = null) {
  const exclusion = exceptId ? 'AND id <> ?' : '';
  const parameters = exceptId
    ? [semesterId, day, end, start, exceptId]
    : [semesterId, day, end, start];
  const [rows] = await connection.execute(
    `SELECT id FROM timetable_entries
     WHERE semester_id = ? AND day_of_week = ? AND is_active = TRUE
       AND start_time < ? AND end_time > ? ${exclusion}
     LIMIT 1 FOR UPDATE`,
    parameters,
  );
  if (rows[0]) throw new HttpError(409, 'This class overlaps another active entry on that day.', 'timetable_overlap');
}

export function createTimetableRouter(pool) {
  const router = Router();
  router.use((req, res, next) => authenticateSession(pool, req, res, next));

  router.get('/', async (req, res) => {
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) return res.json({ semester: null, entries: [], holidays: [] });
    const [[entryRows], [holidayRows]] = await Promise.all([
      pool.execute(
        `SELECT t.id, t.subject_id, t.day_of_week, t.start_time, t.end_time, t.room,
                t.effective_from, t.effective_until, t.is_active,
                s.name AS subject_name, s.code AS subject_code
         FROM timetable_entries t
         JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id
         WHERE t.user_id = ? AND t.semester_id = ?
         ORDER BY t.day_of_week, t.start_time, t.id`,
        [req.auth.userId, semester.id],
      ),
      pool.execute(
        'SELECT id, event_date, reason FROM calendar_events WHERE user_id = ? AND semester_id = ? ORDER BY event_date, id',
        [req.auth.userId, semester.id],
      ),
    ]);
    res.json({ semester: serializeSemester(semester), entries: entryRows.map(serializeEntry), holidays: holidayRows.map(serializeHoliday) });
  });

  router.post('/entries', async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const semester = await lockCurrentSemester(connection, req.auth.userId);
      const input = parseEntry(req.body ?? {}, semester);
      const [subjects] = await connection.execute(
        'SELECT id FROM subjects WHERE id = ? AND user_id = ? AND semester_id = ? AND is_active = TRUE LIMIT 1',
        [input.subjectId, req.auth.userId, semester.id],
      );
      if (!subjects[0]) throw new HttpError(400, 'Choose an active subject from your current semester.', 'invalid_subject');
      if (input.active) await ensureNoOverlap(connection, semester.id, input.dayNumber, input.start, input.end);
      const [result] = await connection.execute(
        `INSERT INTO timetable_entries
           (user_id, semester_id, subject_id, day_of_week, start_time, end_time, room, effective_from, effective_until, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.auth.userId, semester.id, input.subjectId, input.dayNumber, input.start, input.end, input.room, semester.start_date, semester.end_date, input.active],
      );
      await connection.commit();
      const [rows] = await pool.execute(
        `SELECT t.id, t.subject_id, t.day_of_week, t.start_time, t.end_time, t.room, t.effective_from, t.effective_until, t.is_active, s.name AS subject_name, s.code AS subject_code
         FROM timetable_entries t JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id
         WHERE t.id = ? AND t.user_id = ? LIMIT 1`,
        [result.insertId, req.auth.userId],
      );
      res.status(201).json({ entry: serializeEntry(rows[0]) });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      if (error.code === 'ER_NO_REFERENCED_ROW_2') throw new HttpError(400, 'The selected subject is no longer available.', 'invalid_subject');
      throw error;
    } finally { connection.release(); }
  });

  router.put('/entries/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const semester = await lockCurrentSemester(connection, req.auth.userId);
      const input = parseEntry(req.body ?? {}, semester);
      const [existing] = await connection.execute(
        'SELECT id FROM timetable_entries WHERE id = ? AND user_id = ? AND semester_id = ? LIMIT 1 FOR UPDATE',
        [id, req.auth.userId, semester.id],
      );
      if (!existing[0]) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
      const [subjects] = await connection.execute(
        'SELECT id FROM subjects WHERE id = ? AND user_id = ? AND semester_id = ? AND is_active = TRUE LIMIT 1',
        [input.subjectId, req.auth.userId, semester.id],
      );
      if (!subjects[0]) throw new HttpError(400, 'Choose an active subject from your current semester.', 'invalid_subject');
      if (input.active) await ensureNoOverlap(connection, semester.id, input.dayNumber, input.start, input.end, id);
      await connection.execute(
        `UPDATE timetable_entries
         SET subject_id = ?, day_of_week = ?, start_time = ?, end_time = ?, room = ?,
             effective_from = ?, effective_until = ?, is_active = ?
         WHERE id = ? AND user_id = ? AND semester_id = ?`,
        [input.subjectId, input.dayNumber, input.start, input.end, input.room, semester.start_date, semester.end_date, input.active, id, req.auth.userId, semester.id],
      );
      await connection.commit();
      const [rows] = await pool.execute(
        `SELECT t.id, t.subject_id, t.day_of_week, t.start_time, t.end_time, t.room, t.effective_from, t.effective_until, t.is_active, s.name AS subject_name, s.code AS subject_code
         FROM timetable_entries t JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id
         WHERE t.id = ? AND t.user_id = ? LIMIT 1`,
        [id, req.auth.userId],
      );
      res.json({ entry: serializeEntry(rows[0]) });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      if (error.code === 'ER_NO_REFERENCED_ROW_2') throw new HttpError(400, 'The selected subject is no longer available.', 'invalid_subject');
      throw error;
    } finally { connection.release(); }
  });

  router.patch('/entries/:id/active', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
    if (typeof req.body?.active !== 'boolean') throw new HttpError(400, 'Provide active as true or false.', 'invalid_active_status');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const semester = await lockCurrentSemester(connection, req.auth.userId);
      const [rows] = await connection.execute(
        `SELECT t.id, t.day_of_week, t.start_time, t.end_time
         FROM timetable_entries t
         WHERE t.id = ? AND t.user_id = ? AND t.semester_id = ? LIMIT 1 FOR UPDATE`,
        [id, req.auth.userId, semester.id],
      );
      const entry = rows[0];
      if (!entry) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
      if (req.body.active) await ensureNoOverlap(connection, semester.id, Number(entry.day_of_week), String(entry.start_time).slice(0, 5), String(entry.end_time).slice(0, 5), id);
      await connection.execute('UPDATE timetable_entries SET is_active = ? WHERE id = ? AND user_id = ? AND semester_id = ?', [req.body.active, id, req.auth.userId, semester.id]);
      await connection.commit();
      res.json({ id: String(id), active: req.body.active });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      throw error;
    } finally { connection.release(); }
  });

  router.delete('/entries/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const semester = await lockCurrentSemester(connection, req.auth.userId);
      const [entries] = await connection.execute(
        'SELECT id FROM timetable_entries WHERE id = ? AND user_id = ? AND semester_id = ? LIMIT 1 FOR UPDATE',
        [id, req.auth.userId, semester.id],
      );
      if (!entries[0]) throw new HttpError(404, 'Timetable entry not found.', 'entry_not_found');
      const [occurrences] = await connection.execute(
        'SELECT COUNT(*) AS count FROM class_occurrences WHERE timetable_entry_id = ? AND user_id = ?',
        [id, req.auth.userId],
      );
      const hasAttendanceRecords = Number(occurrences[0].count) > 0;
      if (hasAttendanceRecords) {
        // Keep the referenced timetable row so historical attendance records and
        // their foreign-key links remain intact; disabling it stops future generation.
        await connection.execute(
          'UPDATE timetable_entries SET is_active = FALSE WHERE id = ? AND user_id = ? AND semester_id = ?',
          [id, req.auth.userId, semester.id],
        );
      } else {
        await connection.execute(
          'DELETE FROM timetable_entries WHERE id = ? AND user_id = ? AND semester_id = ?',
          [id, req.auth.userId, semester.id],
        );
      }
      await connection.commit();
      res.json({ preservedRecords: hasAttendanceRecords });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      throw error;
    } finally { connection.release(); }
  });

  router.post('/holidays', async (req, res) => {
    const eventDate = typeof req.body?.date === 'string' ? req.body.date : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!validDate(eventDate)) throw new HttpError(400, 'Choose a valid holiday date.', 'invalid_holiday_date');
    if (reason.length > 240) throw new HttpError(400, 'Holiday reason must be 240 characters or fewer.', 'invalid_holiday_reason');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const semester = await lockCurrentSemester(connection, req.auth.userId);
      if (eventDate < dateOnly(semester.start_date) || eventDate > dateOnly(semester.end_date)) {
        throw new HttpError(400, 'Holiday date must fall within the current semester.', 'holiday_outside_semester');
      }
      const [result] = await connection.execute(
        `INSERT INTO calendar_events (user_id, semester_id, event_date, type, reason)
         VALUES (?, ?, ?, 'holiday', ?)`,
        [req.auth.userId, semester.id, eventDate, reason || null],
      );
      const auditReason = reason ? `Holiday: ${reason}` : 'Holiday configured for this class date.';
      await connection.execute(
        `INSERT INTO attendance_changes (user_id, class_occurrence_id, actor_type, old_status, new_status, reason)
         SELECT user_id, id, 'system', 'pending', 'cancelled', ?
         FROM class_occurrences WHERE user_id = ? AND semester_id = ? AND class_date = ? AND status = 'pending'`,
        [auditReason.slice(0, 500), req.auth.userId, semester.id, eventDate],
      );
      const [cancelled] = await connection.execute(
        `UPDATE class_occurrences SET status = 'cancelled', finalized_at = CURRENT_TIMESTAMP(3)
         WHERE user_id = ? AND semester_id = ? AND class_date = ? AND status = 'pending'`,
        [req.auth.userId, semester.id, eventDate],
      );
      await connection.commit();
      res.status(201).json({ holiday: { id: String(result.insertId), date: eventDate, reason: reason || null }, pendingRecordsCancelled: cancelled.affectedRows });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
      if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'A holiday already exists on this date.', 'duplicate_holiday');
      throw error;
    } finally { connection.release(); }
  });

  router.delete('/holidays/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Holiday not found.', 'holiday_not_found');
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) throw new HttpError(404, 'Holiday not found.', 'holiday_not_found');
    const [result] = await pool.execute('DELETE FROM calendar_events WHERE id = ? AND user_id = ? AND semester_id = ?', [id, req.auth.userId, semester.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Holiday not found.', 'holiday_not_found');
    res.status(204).end();
  });

  return router;
}
