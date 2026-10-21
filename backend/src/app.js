import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth.js';
import { createSemestersRouter } from './semesters.js';
import { createSubjectsRouter } from './subjects.js';
import { createTimetableRouter } from './timetable.js';
import { createAttendanceRouter } from './attendance.js';
import { createSchedulerRouter } from './scheduler.js';
import { HttpError } from './errors.js';

export function createApp({ pool, sessionTtlDays, allowedOrigins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new HttpError(403, 'Origin is not allowed.', 'origin_not_allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', database: 'connected' });
  });
  app.use('/api/auth', createAuthRouter(pool, { sessionTtlDays }));
  app.use('/api/semesters', createSemestersRouter(pool));
  app.use('/api/subjects', createSubjectsRouter(pool));
  app.use('/api/timetable', createTimetableRouter(pool));
  app.use('/api/attendance', createAttendanceRouter(pool));
  app.use('/api/scheduler', createSchedulerRouter(pool));

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found.', 'not_found')));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } });
    }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status >= 500) console.error('API request failed:', error.message);
    return res.status(status).json({
      error: {
        code: status >= 500 ? 'internal_error' : (error.code || 'request_error'),
        message: status >= 500 ? 'The server could not complete the request.' : error.message,
      },
    });
  });

  return app;
}
