const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
// Khoá advisory cấp phiên (session-level) để nhiều instance không chạy migration song song.
const MIGRATION_LOCK_KEY = 727001;

function createPool(connectionString = process.env.DATABASE_URL) {
  return new Pool({ connectionString });
}

function listMigrationFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

// Mỗi migration + INSERT vào schema_migrations nằm trong một transaction.
async function ensureMigrationsTable(client) {
  try {
    await client.query('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)');
  } catch (err) {
    // pg-mem không hỗ trợ IF NOT EXISTS khi bảng đã có, nên chỉ bỏ qua đúng lỗi "đã tồn tại".
    if (!/already exists/i.test(err.message)) throw err;
  }
}

async function runMigrations(client, dir) {
  await ensureMigrationsTable(client);
  const done = new Set(
    (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );
  for (const f of listMigrationFiles(dir)) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (err) {
      // Lỗi gốc là thứ cần báo; ROLLBACK thất bại sẽ được phát hiện qua connection bị hỏng.
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }
}

// pool có thể được tiêm (vd. pg-mem) để test.
// advisoryLock: bật khi chạy với Postgres thật (pg-mem không hỗ trợ pg_advisory_lock).
async function migrate(pool, { advisoryLock = false, dir = MIGRATIONS_DIR } = {}) {
  const client = await pool.connect();
  let broken = false;
  try {
    if (advisoryLock) await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await runMigrations(client, dir);
    if (advisoryLock) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  } catch (err) {
    // Connection có thể còn giữ khoá: huỷ nó thay vì trả lại pool.
    broken = advisoryLock;
    throw err;
  } finally {
    client.release(broken || undefined);
  }
}

module.exports = { createPool, migrate };
