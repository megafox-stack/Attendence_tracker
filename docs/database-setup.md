# Local MySQL, migrations, and offline Android storage

The installed Android app now stores day-to-day attendance locally in Room/SQLite and does not require MySQL, an API server, or an internet connection. MySQL instructions below are for the existing development backend and for exporting its data before moving it to a device.

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

## Export existing account data for offline Android migration

Before installing the Room-backed offline app, export each account from the existing MySQL database into a versioned JSON backup. This command reads the database and writes a new file without modifying or deleting server data:

```powershell
npm run db:export-account -- student@example.com .\attendance-backup.json
```

The export omits account credentials and session tokens. Keep the backup private; it contains attendance and timetable data. In the Android app, choose **Restore backup** and select this file. Restore validates the complete file before replacing any on-device dataset. Existing MySQL data remains untouched.

The exporter writes format version 1, includes attendance change history and scheduler settings, and never overwrites an existing output file. When the former MySQL schema contains multiple occurrences tied to the same recurring entry and date, the export preserves every occurrence with hidden, inactive historical timetable aliases so the offline database can enforce its stricter unique `(timetable entry, class date)` rule. These aliases do not appear in the editable weekly timetable.

### Build and verify the offline Android app

1. In Android Studio, sync the Gradle project after `npx cap sync android`.
2. Build and install the debug APK. The app database is `attendance-tracker.db` in Android's private app storage.
3. Enable airplane mode, configure a semester, subject, and recurring class, then enable the on-device scheduler.
4. Reopen the app and check Home, Attendance, Timetable, Daily Review, and Insights. Only generated or manually confirmed records appear; no sample records are created.
5. From Home, export a backup. To restore, choose a backup and confirm replacement. A malformed file is rejected before local records are changed.

WorkManager runs the daily scheduler locally. Android may defer background work due to power management, and it cannot run while the app is force-stopped. On a scheduled check, it generates only that local calendar date's Pending records, skipping holidays, inactive entries, and dates outside the configured semester. Repeated checks use the unique timetable-entry/date constraint and do not overwrite reviewed records.

## Current scope

Migrations 0001–0007 cover the former account-based schema, including users, semesters, subjects, timetable entries, calendar events, class occurrences, attendance change history, hashed API sessions, scheduler settings, and semester working-day settings. The offline Android app does not call these API routes. Server data remains on the server until the read-only export file is explicitly restored on a device.

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
