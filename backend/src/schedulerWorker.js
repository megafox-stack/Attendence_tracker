const ISO_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function localDate(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function isoWeekday(date) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function runSchedulerTick(pool, now = new Date()) {
  const connection = await pool.getConnection();
  const result = { checked: 0, created: 0, skipped: 0, errors: 0 };
  try {
    await connection.beginTransaction();
    const [accounts] = await connection.execute(
      'SELECT user_id FROM scheduler_settings WHERE enabled = TRUE ORDER BY user_id FOR UPDATE SKIP LOCKED',
    );

    for (const account of accounts) {
      result.checked += 1;
      try {
        const [semesters] = await connection.execute(
          `SELECT id, start_date, end_date, working_days_mask, time_zone
           FROM semesters WHERE user_id = ? AND status IN ('active', 'draft')
           ORDER BY (status = 'active') DESC, updated_at DESC, id DESC LIMIT 1`,
          [account.user_id],
        );
        const semester = semesters[0];
        if (!semester) { result.skipped += 1; continue; }
        const date = localDate(semester.time_zone, now);
        const start = dateOnly(semester.start_date);
        const end = dateOnly(semester.end_date);
        if (date >= start && date <= end) {
          const day = isoWeekday(date);
          if (Number(semester.working_days_mask) & (1 << (day - 1))) {
            const [holidays] = await connection.execute(
              "SELECT id FROM calendar_events WHERE user_id = ? AND semester_id = ? AND event_date = ? AND type = 'holiday' LIMIT 1",
              [account.user_id, semester.id, date],
            );
            if (!holidays[0]) {
              const [insert] = await connection.execute(
                `INSERT INTO class_occurrences
                   (user_id, semester_id, timetable_entry_id, subject_id, class_date, scheduled_start, scheduled_end,
                    subject_name_snapshot, subject_code_snapshot, room_snapshot, status)
                 SELECT t.user_id, t.semester_id, t.id, t.subject_id, ?, t.start_time, t.end_time,
                        s.name, s.code, t.room, 'pending'
                 FROM timetable_entries t
                 JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id AND s.semester_id = t.semester_id
                 WHERE t.user_id = ? AND t.semester_id = ? AND t.day_of_week = ? AND t.is_active = TRUE
                   AND s.is_active = TRUE AND t.effective_from <= ? AND t.effective_until >= ?
                 ON DUPLICATE KEY UPDATE id = class_occurrences.id`,
                [date, account.user_id, semester.id, day, date, date],
              );
              result.created += Number(insert.affectedRows || 0);
            }
          }
        }
        await connection.execute(
          'UPDATE scheduler_settings SET last_run_at = CURRENT_TIMESTAMP(3), last_run_date = ?, last_error = NULL WHERE user_id = ?',
          [date, account.user_id],
        );
      } catch (error) {
        result.errors += 1;
        await connection.execute(
          'UPDATE scheduler_settings SET last_run_at = CURRENT_TIMESTAMP(3), last_error = ? WHERE user_id = ?',
          [String(error.message || 'Scheduler run failed').slice(0, 500), account.user_id],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  return result;
}

export function startSchedulerWorker(pool, { intervalMs = 60_000, logger = console } = {}) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await runSchedulerTick(pool);
      if (result.checked) logger.info?.(`Scheduler checked ${result.checked} account(s); created ${result.created} Pending record(s).`);
    } catch (error) {
      logger.error?.('Scheduler tick failed:', error.message);
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}

export function schedulerWeekday(date) { return ISO_DAYS[isoWeekday(date) - 1]; }
