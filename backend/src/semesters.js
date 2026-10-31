import { Router } from 'express';
import { authenticateSession } from './auth.js';
import { HttpError } from './errors.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function encodeWorkingDays(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((day) => !DAYS.includes(day)) || new Set(value).size !== value.length) {
    throw new HttpError(400, 'Choose at least one valid working day.', 'invalid_working_days');
  }
  return DAYS.reduce((mask, day, index) => value.includes(day) ? mask | (1 << index) : mask, 0);
}

export function decodeWorkingDays(mask) {
  return DAYS.filter((_day, index) => (Number(mask) & (1 << index)) !== 0);
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function serializeSemester(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    workingDays: decodeWorkingDays(row.working_days_mask),
    attendanceTargetPercent: row.attendance_target_percent === null ? null : Number(row.attendance_target_percent),
    status: row.status,
    timeZone: row.time_zone,
  };
}

export async function findCurrentSemester(pool, userId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id, user_id, name, start_date, end_date, working_days_mask,
            attendance_target_percent, status, time_zone
     FROM semesters
     WHERE user_id = ? AND status IN ('active', 'draft')
     ORDER BY (status = 'active') DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

function readSemesterInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  const endDate = typeof body.endDate === 'string' ? body.endDate : '';
  const attendanceTargetPercent = body.attendanceTargetPercent === '' || body.attendanceTargetPercent == null
    ? null
    : Number(body.attendanceTargetPercent);
  const workingDaysMask = encodeWorkingDays(body.workingDays);

  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!name || name.length > 120) throw new HttpError(400, 'Semester name is required and must be at most 120 characters.', 'invalid_semester_name');
  if (!validDate(startDate) || !validDate(endDate)) throw new HttpError(400, 'Provide valid semester start and end dates.', 'invalid_semester_dates');
  if (endDate < startDate) throw new HttpError(400, 'Semester end date must be on or after its start date.', 'invalid_semester_dates');
  if (attendanceTargetPercent !== null && (!Number.isFinite(attendanceTargetPercent) || attendanceTargetPercent < 0 || attendanceTargetPercent > 100)) {
    throw new HttpError(400, 'Attendance target must be between 0 and 100.', 'invalid_attendance_target');
  }
  return { name, startDate, endDate, attendanceTargetPercent, workingDaysMask };
}

export function createSemestersRouter(pool) {
  const router = Router();
  router.use((req, res, next) => authenticateSession(pool, req, res, next));

  router.get('/current', async (req, res) => {
    const row = await findCurrentSemester(pool, req.auth.userId);
    res.json({ semester: serializeSemester(row) });
  });

  router.put('/current', async (req, res) => {
    const input = readSemesterInput(req.body ?? {});
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute('SELECT time_zone FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.auth.userId]);
      if (!users[0]) throw new HttpError(401, 'Account is no longer available.', 'invalid_session');
      const current = await findCurrentSemester(pool, req.auth.userId, connection);
      if (current) {
        await connection.execute(
          `UPDATE semesters
           SET name = ?, start_date = ?, end_date = ?, working_days_mask = ?, attendance_target_percent = ?, time_zone = ?
           WHERE id = ? AND user_id = ?`,
          [input.name, input.startDate, input.endDate, input.workingDaysMask, input.attendanceTargetPercent, users[0].time_zone, current.id, req.auth.userId],
        );
      } else {
        await connection.execute(
          `INSERT INTO semesters
             (user_id, name, start_date, end_date, time_zone, attendance_target_percent, working_days_mask, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [req.auth.userId, input.name, input.startDate, input.endDate, users[0].time_zone, input.attendanceTargetPercent, input.workingDaysMask],
        );
      }
      await connection.commit();
      const saved = await findCurrentSemester(pool, req.auth.userId);
      res.json({ semester: serializeSemester(saved) });
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      connection.release();
    }
  });

  return router;
}
