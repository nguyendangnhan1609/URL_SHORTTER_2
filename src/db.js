const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function createPool(connectionString = process.env.DATABASE_URL) {
  return new Pool({ connectionString });
}

// pool có thể được tiêm (vd. pg-mem) để test.
async function migrate(pool) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let done;
  try {
    done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  } catch (e) {
    await pool.query('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)');
    done = new Set();
  }
  for (const f of files) {
    if (done.has(f)) continue;
    await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
}

module.exports = { createPool, migrate };
