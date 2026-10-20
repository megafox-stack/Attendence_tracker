import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createApp } from './app.js';

function integerEnv(name, fallback, { min, max }) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const port = integerEnv('API_PORT', '3001', { min: 1, max: 65535 });
const sessionTtlDays = integerEnv('SESSION_TTL_DAYS', '14', { min: 1, max: 90 });
const dbPort = integerEnv('DB_PORT', '3306', { min: 1, max: 65535 });
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME || 'attendance_tracker';
if (!dbUser || !dbPassword) throw new Error('DB_USER and DB_PASSWORD must be set in the project .env file.');

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || (nodeEnv === 'development'
    ? 'http://localhost:5173,http://127.0.0.1:5173,https://localhost,capacitor://localhost'
    : ''))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
if (nodeEnv === 'production' && allowedOrigins.size === 0) {
  throw new Error('CORS_ORIGINS must contain the deployed frontend origin in production.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  charset: 'utf8mb4',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: integerEnv('DB_POOL_SIZE', '10', { min: 1, max: 100 }),
  queueLimit: 0,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

const app = createApp({ pool, sessionTtlDays, allowedOrigins });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Attendance API listening on port ${port} (${nodeEnv}).`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down API.`);
  server.close(async (error) => {
    try {
      await pool.end();
      process.exitCode = error ? 1 : 0;
    } catch (shutdownError) {
      console.error('API shutdown failed:', shutdownError.message);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
