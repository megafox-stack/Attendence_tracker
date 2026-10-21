import { Router } from 'express';
import { authenticateSession } from './auth.js';
import { HttpError } from './errors.js';

const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

async function ensureSettings(pool, userId) {
  await pool.execute('INSERT IGNORE INTO scheduler_settings (user_id, enabled) VALUES (?, FALSE)', [userId]);
}

async function readStatus(pool, userId) {
  await ensureSettings(pool, userId);
  const [settingsResult, semestersResult] = await Promise.all([
    pool.execute('SELECT enabled, last_run_at, last_run_date, last_error FROM scheduler_settings WHERE user_id = ?', [userId]),
    pool.execute(
      `SELECT s.id, s.start_date, s.end_date,
              (SELECT COUNT(*) FROM timetable_entries t JOIN subjects sub ON sub.id = t.subject_id AND sub.user_id = t.user_id AND sub.semester_id = t.semester_id
               WHERE t.user_id = s.user_id AND t.semester_id = s.id AND t.is_active = TRUE AND sub.is_active = TRUE) AS active_entries
       FROM semesters s WHERE s.user_id = ? AND s.status IN ('active', 'draft')
       ORDER BY (s.status = 'active') DESC, s.updated_at DESC, s.id DESC LIMIT 1`,
      [userId],
    ),
  ]);
  const setting = settingsResult[0][0];
  const semester = semestersResult[0][0];
  const configured = Boolean(semester && Number(semester.active_entries) > 0);
  return {
    enabled: Boolean(setting.enabled),
    configured,
    status: setting.enabled && setting.last_error ? 'error' : setting.enabled ? (configured ? 'active' : 'setup_required') : (configured ? 'disabled' : 'not_configured'),
    lastRunAt: setting.last_run_at ? new Date(setting.last_run_at).toISOString() : null,
    lastRunDate: setting.last_run_date ? dateOnly(setting.last_run_date) : null,
    lastError: setting.last_error || null,
    nextRun: setting.enabled ? 'Within one minute; server checks every minute.' : null,
  };
}

export function createSchedulerRouter(pool) {
  const router = Router();
  router.use((req, res, next) => authenticateSession(pool, req, res, next));

  router.get('/status', async (req, res) => {
    res.json({ scheduler: await readStatus(pool, req.auth.userId) });
  });

  router.put('/settings', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, 'Provide enabled as true or false.', 'invalid_scheduler_setting');
    await ensureSettings(pool, req.auth.userId);
    if (req.body.enabled) {
      const status = await readStatus(pool, req.auth.userId);
      if (!status.configured) throw new HttpError(409, 'Configure a semester, subject, and active weekly class before enabling the scheduler.', 'scheduler_setup_required');
    }
    await pool.execute(
      `UPDATE scheduler_settings SET enabled = ?, last_run_date = IF(? = TRUE, NULL, last_run_date), last_error = NULL WHERE user_id = ?`,
      [req.body.enabled, req.body.enabled, req.auth.userId],
    );
    res.json({ scheduler: await readStatus(pool, req.auth.userId) });
  });

  return router;
}
