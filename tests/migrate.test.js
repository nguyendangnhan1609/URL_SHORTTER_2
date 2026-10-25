const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate } = require('../src/db');

// pg-mem không rollback thật, nên kiểm thứ tự BEGIN/COMMIT/ROLLBACK bằng client giả.
function fakePool({ failOn } = {}) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push(sql.trim().split('\n')[0]);
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      return { rows: [] };
    },
    release: (err) => calls.push(err ? 'RELEASE(destroy)' : 'RELEASE'),
  };
  return { calls, pool: { connect: async () => client } };
}

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (id INT);');
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b (id INT);');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('each migration runs inside BEGIN/COMMIT with its schema_migrations insert', async () => {
  const { pool, calls } = fakePool();
  await migrate(pool, { dir });
  const i = calls.indexOf('BEGIN');
  expect(calls.slice(i, i + 4)).toEqual([
    'BEGIN',
    'CREATE TABLE a (id INT);',
    'INSERT INTO schema_migrations (name) VALUES ($1)',
    'COMMIT',
  ]);
  expect(calls).not.toContain('pg_advisory_lock($1)');
  expect(calls.at(-1)).toBe('RELEASE');
});

test('a failing migration is rolled back, rethrown, and not recorded', async () => {
  const { pool, calls } = fakePool({ failOn: 'CREATE TABLE b' });
  await expect(migrate(pool, { dir })).rejects.toThrow('boom');
  expect(calls).toContain('ROLLBACK');
  expect(calls.filter((c) => c === 'COMMIT').length).toBe(1); // chỉ 001 được commit
  expect(calls.filter((c) => c.startsWith('INSERT')).length).toBe(1);
  expect(calls.at(-1)).toBe('RELEASE');
});

test('advisoryLock takes and releases the lock on the same connection', async () => {
  const { pool, calls } = fakePool();
  await migrate(pool, { dir, advisoryLock: true });
  expect(calls[0]).toBe('SELECT pg_advisory_lock($1)');
  expect(calls).toContain('SELECT pg_advisory_unlock($1)');
});
