import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const directory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(directory, 'migrations');

function loadEnvFile() {
  // Keep the runner dependency-light; do not overwrite variables already set by the shell.
  try {
    const content = readFileSync(join(directory, '..', '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing ${name}. Copy .env.example to .env and configure it.`);
  return value;
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function listMigrations() {
  const files = await readdir(migrationsDirectory);
  return files
    .filter((file) => /^\d{4}_[a-z0-9_]+\.up\.sql$/i.test(file))
    .sort()
    .map((upFile) => ({
      version: upFile.replace(/\.up\.sql$/i, ''),
      upFile,
      downFile: upFile.replace(/\.up\.sql$/i, '.down.sql'),
    }));
}

async function migrateUp(connection) {
  const migrations = await listMigrations();
  const [appliedRows] = await connection.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
  const known = new Set(migrations.map((migration) => migration.version));

  for (const version of applied.keys()) {
    if (!known.has(version)) throw new Error(`Applied migration ${version} is missing from database/migrations.`);
  }

  for (const migration of migrations) {
    const sql = await readFile(join(migrationsDirectory, migration.upFile), 'utf8');
    const checksum = sha256(sql);
    if (applied.has(migration.version)) {
      if (applied.get(migration.version) !== checksum) {
        throw new Error(`Migration ${migration.version} changed after application. Add a new migration instead of editing an applied file.`);
      }
      continue;
    }

    console.log(`Applying ${migration.version}...`);
    try {
      // MySQL DDL implicitly commits. A failed file may be partially applied; inspect and repair
      // the database before retrying rather than claiming this is transactionally atomic.
      await connection.query(sql);
      await connection.execute(
        'INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)',
        [migration.version, checksum],
      );
      applied.set(migration.version, checksum);
      console.log(`Applied ${migration.version}.`);
    } catch (error) {
      throw new Error(`Migration ${migration.version} failed. MySQL DDL may have partially applied; inspect the schema before retrying. ${error.message}`, { cause: error });
    }
  }

  console.log('Database schema is up to date.');
}

async function migrateDown(connection, version, confirmation) {
  if (!version || confirmation !== '--confirm') {
    throw new Error('Rollback requires an exact migration version and --confirm. Example: npm run db:down -- 0003_class_occurrences_attendance_changes --confirm');
  }
  const migrations = await listMigrations();
  const migration = migrations.find((item) => item.version === version);
  if (!migration) throw new Error(`Unknown migration version: ${version}`);
  const [appliedRows] = await connection.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const latest = appliedRows.at(-1);
  if (!latest) throw new Error('There are no applied migrations to roll back.');
  if (latest.version !== version) throw new Error(`Only the latest applied migration (${latest.version}) can be rolled back.`);

  const upSql = await readFile(join(migrationsDirectory, migration.upFile), 'utf8');
  if (latest.checksum !== sha256(upSql)) throw new Error(`Migration ${version} checksum differs from the applied version; refusing rollback.`);
  const downSql = await readFile(join(migrationsDirectory, migration.downFile), 'utf8');
  console.log(`Rolling back ${version}...`);
  try {
    await connection.query(downSql);
    await connection.execute('DELETE FROM schema_migrations WHERE version = ?', [version]);
  } catch (error) {
    throw new Error(`Rollback ${version} failed. MySQL DDL may have partially applied; inspect the schema before retrying. ${error.message}`, { cause: error });
  }
  console.log(`Rolled back ${version}.`);
}

async function main() {
  loadEnvFile();
  const action = process.argv[2];
  if (!['up', 'down'].includes(action)) throw new Error('Usage: node database/migrate.js up | down <version> --confirm');

  const connection = await mysql.createConnection({
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(required('DB_PORT', '3306')),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME', 'attendance_tracker'),
    charset: 'utf8mb4',
    multipleStatements: true,
    timezone: 'Z',
  });

  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(160) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    if (action === 'up') await migrateUp(connection);
    else await migrateDown(connection, process.argv[3], process.argv[4]);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Migration runner: ${error.message}`);
  process.exitCode = 1;
});
