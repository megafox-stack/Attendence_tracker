import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './passwords.js';
import { createSessionToken, getSessionExpiry, hashSessionToken } from './sessions.js';
import { HttpError } from './errors.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } },
});

function normalizeRegistration(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null;
  const timeZone = typeof body.timeZone === 'string' ? body.timeZone.trim() : '';

  if (!emailPattern.test(email) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid email address.', 'invalid_email');
  }
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new HttpError(400, 'Password must be at least 12 characters and no more than 1024 bytes.', 'invalid_password');
  }
  if (displayName && displayName.length > 120) {
    throw new HttpError(400, 'Display name must be 120 characters or fewer.', 'invalid_display_name');
  }
  if (!timeZone || timeZone.length > 64) {
    throw new HttpError(400, 'Provide a valid IANA time zone.', 'invalid_time_zone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new HttpError(400, 'Provide a valid IANA time zone.', 'invalid_time_zone');
  }
  return { email, password, displayName: displayName || null, timeZone };
}

async function insertSession(connection, userId, ttlDays) {
  const { token, tokenHash } = createSessionToken();
  const expiresAt = getSessionExpiry(ttlDays);
  await connection.execute(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [tokenHash, userId, expiresAt],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export function createAuthRouter(pool, { sessionTtlDays }) {
  const router = Router();

  router.post('/register', authLimiter, async (req, res) => {
    const input = normalizeRegistration(req.body ?? {});
    const passwordHash = await hashPassword(input.password);
    let userId;
    let session;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        'INSERT INTO users (email, password_hash, display_name, time_zone) VALUES (?, ?, ?, ?)',
        [input.email, passwordHash, input.displayName, input.timeZone],
      );
      userId = result.insertId;
      session = await insertSession(connection, userId, sessionTtlDays);
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch { /* Preserve the original database error. */ }
      if (error.code === 'ER_DUP_ENTRY') {
        throw new HttpError(409, 'An account with these details already exists.', 'account_conflict');
      }
      throw error;
    } finally {
      connection.release();
    }

    res.status(201).json({
      user: { id: String(userId), email: input.email, displayName: input.displayName, timeZone: input.timeZone, emailVerified: false },
      session,
    });
  });

  router.post('/login', authLimiter, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!emailPattern.test(email) || email.length > 254 || !password || Buffer.byteLength(password, 'utf8') > 1024) {
      throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
    }

    const [rows] = await pool.execute(
      'SELECT id, email, password_hash, display_name, time_zone, email_verified_at FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    const user = rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');

    await pool.execute('DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
    const session = await insertSession(pool, user.id, sessionTtlDays);
    res.json({
      user: { id: String(user.id), email: user.email, displayName: user.display_name, timeZone: user.time_zone, emailVerified: Boolean(user.email_verified_at) },
      session,
    });
  });

  router.post('/logout', async (req, res) => {
    const token = bearerToken(req);
    await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    res.status(204).end();
  });

  router.get('/me', async (req, res) => {
    const token = bearerToken(req);
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.display_name, u.time_zone, u.email_verified_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [hashSessionToken(token)],
    );
    if (!rows[0]) throw new HttpError(401, 'Session is invalid or expired.', 'invalid_session');
    const user = rows[0];
    res.json({ user: { id: String(user.id), email: user.email, displayName: user.display_name, timeZone: user.time_zone, emailVerified: Boolean(user.email_verified_at) } });
  });

  return router;
}

export function bearerToken(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) throw new HttpError(401, 'A valid bearer session is required.', 'missing_session');
  return match[1];
}

export async function authenticateSession(pool, req, _res, next) {
  try {
    const token = bearerToken(req);
    const [rows] = await pool.execute(
      'SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3) LIMIT 1',
      [hashSessionToken(token)],
    );
    if (!rows[0]) throw new HttpError(401, 'Session is invalid or expired.', 'invalid_session');
    req.auth = { userId: String(rows[0].user_id) };
    next();
  } catch (error) {
    next(error);
  }
}
