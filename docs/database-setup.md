# Local MySQL and migrations

This configures a local development database only. Production should use a managed MySQL service, separate credentials, TLS, and backups.

## Requirements

- Docker Desktop with the Linux container engine running.
- Node.js 20 or newer.

## Start local MySQL

1. Copy `.env.example` to `.env` and replace both example passwords with unique local values.
2. Start Docker Desktop and wait until its engine is ready.
3. From the project root run `docker compose up -d mysql`.
4. Wait for MySQL to become healthy with `docker compose ps`.
5. Run `npm run db:up` to apply all pending migrations.
6. Start the API with `npm run dev:api` in a second terminal.

MySQL is published only on `127.0.0.1:3306`; the data lives in the `attendance_mysql_data` Docker volume. Do not use the example passwords outside a local development machine.

## Migration commands

- `npm run db:up` applies pending migrations in filename order.
- `npm run db:down -- 0005_semester_working_days --confirm` rolls back only the latest applied migration. Rollbacks permanently remove the data represented by that migration; back up first.

The runner creates a `schema_migrations` table, stores a SHA-256 checksum for every applied migration, and refuses to run if an applied migration file has changed. MySQL DDL statements implicitly commit, so a failed migration may have partially changed the schema; inspect the database before retrying.

## Current scope

Migrations 0001–0005 cover users, semesters, subjects, timetable entries, calendar events, class occurrences, attendance change history, hashed API sessions, and semester working-day settings. The API provides authenticated semester, subject, recurring timetable-entry, holiday, explicit class-record preparation, and attendance update management. No records are seeded, and class records are only created after a user explicitly prepares a date; no background scheduler runs.

## Local API

The API listens on `http://localhost:3001` by default. Its readiness endpoint is `GET /api/health/ready`; auth endpoints are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. The first two return a bearer session token; send it as `Authorization: Bearer <token>` to authenticated endpoints. Passwords must be at least 12 characters. Registration asks for an IANA time zone. The raw session token is returned once; only its SHA-256 digest is stored in MySQL.

Authenticated data endpoints include `GET /api/attendance/classes?date=YYYY-MM-DD`, `POST /api/attendance/classes/generate`, `PATCH /api/attendance/classes/:id`, `POST /api/attendance/bulk`, and `POST /api/attendance/daily-submission`. Preparation is an explicit user action for today or a future configured working day, skips holidays, and is duplicate-safe. Status submissions are transactional and record changes in `attendance_changes`. `POST /api/timetable/holidays` cancels pending occurrences for that date while preserving recurring entries and existing finalized history. These endpoints do not start a scheduler.

The Vite frontend reads `VITE_API_URL` from `.env`; use `http://localhost:3001/api` for a browser running on the same computer. The current frontend holds the bearer token in memory only, so signing in again is required after an app restart. It does not store the token in local storage. On a physical Android phone, `localhost` refers to the phone itself; use a secure HTTPS API address reachable by the phone for device testing rather than exposing the development API over plain HTTP.

### Physical Android phone over Wi-Fi debugging

For a local debug APK, this project uses ADB reverse forwarding so the phone's `localhost:3001` reaches the API on this computer. This does not open the API to your Wi-Fi network.

1. Keep `VITE_API_URL=http://localhost:3001/api` in your ignored local `.env` file.
2. Start MySQL and the API (`docker compose up -d mysql`, then `npm run dev:api`).
3. Connect the phone using Android wireless debugging, then run `npm run android:api-forward`.
4. Build/install the debug APK with `npm run build:apk`, or install `android/app/build/outputs/apk/debug/app-debug.apk` from Android Studio.
5. Keep wireless debugging and the API running while using sign in. If the phone or ADB reconnects, run `npm run android:api-forward` again.

The debug APK alone allows the local HTTP request needed for this tunnel. The release manifest keeps cleartext traffic disabled; configure HTTPS for any deployed API before making a release APK.

Email verification and password recovery are not implemented. Do not expose this API publicly until those account recovery controls, HTTPS, production secrets, and deployment-specific rate limiting are in place. The local in-memory login rate limiter is not shared between multiple API instances.
