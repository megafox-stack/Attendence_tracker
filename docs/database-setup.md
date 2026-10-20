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

MySQL is published only on `127.0.0.1:3306`; the data lives in the `attendance_mysql_data` Docker volume. Do not use the example passwords outside a local development machine.

## Migration commands

- `npm run db:up` applies pending migrations in filename order.
- `npm run db:down -- 0003_class_occurrences_attendance_changes --confirm` rolls back only the latest applied migration. Rollbacks permanently remove the data represented by that migration; back up first.

The runner creates a `schema_migrations` table, stores a SHA-256 checksum for every applied migration, and refuses to run if an applied migration file has changed. MySQL DDL statements implicitly commit, so a failed migration may have partially changed the schema; inspect the database before retrying.

## Current scope

Migrations 0001–0003 cover users, semesters, subjects, timetable entries, calendar events, class occurrences, and attendance change history. The runner does not seed records, start a backend API, or connect the frontend. Configure it with a local disposable database first; use a separate managed MySQL instance for deployment.
