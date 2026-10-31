import { Router } from 'express';
import { authenticateSession } from './auth.js';
import { HttpError } from './errors.js';
import { findCurrentSemester } from './semesters.js';

function parseSubject(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const attendanceTargetPercent = body.attendanceTargetPercent === '' || body.attendanceTargetPercent == null
    ? null
    : Number(body.attendanceTargetPercent);
  if (!name || name.length > 160) throw new HttpError(400, 'Subject name is required and must be at most 160 characters.', 'invalid_subject_name');
  if (!code || code.length > 40) throw new HttpError(400, 'Subject code is required and must be at most 40 characters.', 'invalid_subject_code');
  if (attendanceTargetPercent !== null && (!Number.isFinite(attendanceTargetPercent) || attendanceTargetPercent < 0 || attendanceTargetPercent > 100)) {
    throw new HttpError(400, 'Attendance target must be between 0 and 100.', 'invalid_attendance_target');
  }
  return { name, code, attendanceTargetPercent };
}

function serializeSubject(row) {
  return {
    id: String(row.id),
    name: row.name,
    code: row.code,
    attendanceTargetPercent: row.attendance_target_percent === null ? null : Number(row.attendance_target_percent),
    active: Boolean(row.is_active),
  };
}

function handleDuplicate(error) {
  if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'A subject with that code already exists in this semester.', 'duplicate_subject_code');
  throw error;
}

export function createSubjectsRouter(pool) {
  const router = Router();
  router.use((req, res, next) => authenticateSession(pool, req, res, next));

  router.get('/', async (req, res) => {
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) return res.json({ subjects: [] });
    const [rows] = await pool.execute(
      `SELECT id, name, code, attendance_target_percent, is_active
       FROM subjects WHERE user_id = ? AND semester_id = ? ORDER BY name, code`,
      [req.auth.userId, semester.id],
    );
    res.json({ subjects: rows.map(serializeSubject) });
  });

  router.post('/', async (req, res) => {
    const input = parseSubject(req.body ?? {});
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) throw new HttpError(409, 'Set up a semester before adding subjects.', 'semester_required');
    try {
      const [result] = await pool.execute(
        `INSERT INTO subjects (user_id, semester_id, name, code, attendance_target_percent)
         VALUES (?, ?, ?, ?, ?)`,
        [req.auth.userId, semester.id, input.name, input.code, input.attendanceTargetPercent],
      );
      const [rows] = await pool.execute(
        'SELECT id, name, code, attendance_target_percent, is_active FROM subjects WHERE id = ? AND user_id = ? LIMIT 1',
        [result.insertId, req.auth.userId],
      );
      res.status(201).json({ subject: serializeSubject(rows[0]) });
    } catch (error) { handleDuplicate(error); }
  });

  router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
    const input = parseSubject(req.body ?? {});
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
    try {
      const [result] = await pool.execute(
        `UPDATE subjects SET name = ?, code = ?, attendance_target_percent = ?
         WHERE id = ? AND user_id = ? AND semester_id = ?`,
        [input.name, input.code, input.attendanceTargetPercent, id, req.auth.userId, semester.id],
      );
      if (result.affectedRows === 0) {
        const [rows] = await pool.execute('SELECT id FROM subjects WHERE id = ? AND user_id = ? AND semester_id = ? LIMIT 1', [id, req.auth.userId, semester.id]);
        if (!rows[0]) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
      }
      const [rows] = await pool.execute('SELECT id, name, code, attendance_target_percent, is_active FROM subjects WHERE id = ? AND user_id = ? LIMIT 1', [id, req.auth.userId]);
      res.json({ subject: serializeSubject(rows[0]) });
    } catch (error) { handleDuplicate(error); }
  });

  router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
    const semester = await findCurrentSemester(pool, req.auth.userId);
    if (!semester) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
    try {
      const [result] = await pool.execute('DELETE FROM subjects WHERE id = ? AND user_id = ? AND semester_id = ?', [id, req.auth.userId, semester.id]);
      if (!result.affectedRows) throw new HttpError(404, 'Subject not found.', 'subject_not_found');
      res.status(204).end();
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2') throw new HttpError(409, 'This subject is used by timetable entries. Remove or reassign those entries before deleting it.', 'subject_in_use');
      throw error;
    }
  });

  return router;
}
