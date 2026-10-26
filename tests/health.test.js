const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

let pool;

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
});

afterAll(() => pool.end());

test('migrate is idempotent and creates links table', async () => {
  await migrate(pool);
  await pool.query("INSERT INTO links (slug, target_url) VALUES ('probe', 'http://p.com')");
  const r = await pool.query("SELECT * FROM links WHERE slug='probe'");
  expect(Object.keys(r.rows[0]).sort()).toEqual(['clicks', 'created_at', 'id', 'slug', 'target_url', 'user_id']);
  await pool.query("DELETE FROM links WHERE slug='probe'");
});

test('slug is UNIQUE', async () => {
  await pool.query("INSERT INTO links (slug, target_url) VALUES ('abc', 'http://a.com')");
  await expect(
    pool.query("INSERT INTO links (slug, target_url) VALUES ('abc', 'http://b.com')")
  ).rejects.toThrow();
  const r = await pool.query("SELECT clicks FROM links WHERE slug='abc'");
  expect(Number(r.rows[0].clicks)).toBe(0);
});

test('GET /healthz returns ok', async () => {
  const res = await request(createApp({ pool })).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
