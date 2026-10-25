const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

let pool, app;

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool });
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await pool.end();
});

const create = async (body) => (await request(app).post('/api/links').send(body)).body;
const clicksOf = async (slug) =>
  Number((await pool.query('SELECT clicks FROM links WHERE slug = $1', [slug])).rows[0].clicks);

test('HEAD /:slug on existing link -> 302 with Location and empty body', async () => {
  await create({ url: 'https://example.com/head', slug: 'head-ok' });
  const res = await request(app).head('/head-ok');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://example.com/head');
});

test('HEAD /:slug on unknown slug -> 404', async () => {
  const res = await request(app).head('/no-such-slug');
  expect(res.status).toBe(404);
});

test('slug boundary: 3 chars and 32 chars redirect; 2 and 33 chars do not', async () => {
  await create({ url: 'https://example.com/min', slug: 'abc' });
  await create({ url: 'https://example.com/max', slug: 'a'.repeat(32) });
  await request(app).get('/abc').expect(302);
  await request(app).get(`/${'a'.repeat(32)}`).expect(302);
  await request(app).get('/ab').expect(404);
  await request(app).get(`/${'a'.repeat(33)}`).expect(404);
});

test('slug is case-sensitive (per SPEC): different case -> 404', async () => {
  await create({ url: 'https://example.com/case', slug: 'CaseX1' });
  await request(app).get('/CaseX1').expect(302);
  await request(app).get('/casex1').expect(404);
});

test.each([
  ['/a%2Fb'],
  ['/..%2f'],
  ['/..%2F..%2Fetc%2Fpasswd'],
  ['/.env'],
  ['/%00'],
  ['/abc%20def'],
  ['/a%0d%0ab'],
  ['/%3Cscript%3E'],
])('odd slug %s -> 404 without DB access', async (path) => {
  const spy = jest.spyOn(pool, 'query');
  const res = await request(app).get(path);
  expect(res.status).toBe(404);
  expect(res.headers.location).toBeUndefined();
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

// KNOWN BUG (found by independent test run): malformed percent-encoding makes Express
// throw URIError with status 400, but the global error handler in src/app.js ignores
// err.status and answers 500 INTERNAL_ERROR. Expected 400. Remove .failing once fixed.
test.failing('malformed percent-encoding /%E0%A4%A -> 400, not 500', async () => {
  const res = await request(app).get('/%E0%A4%A');
  expect(res.status).toBe(400);
});

test('clicks are flushed by the background timer without any API read', async () => {
  await create({ url: 'https://example.com/timer', slug: 'timer-1' });
  for (let i = 0; i < 3; i++) await request(app).get('/timer-1').expect(302);
  await new Promise((r) => setTimeout(r, 1300));
  expect(await clicksOf('timer-1')).toBe(3);
});

test('50 concurrent redirects -> clicks exactly 50 (no lost or double counts)', async () => {
  await create({ url: 'https://example.com/burst', slug: 'burst-1' });
  await Promise.all(Array.from({ length: 50 }, () => request(app).get('/burst-1').expect(302)));
  await app.locals.clicks.flush();
  expect(await clicksOf('burst-1')).toBe(50);
});

test('stop() flushes pending clicks before returning', async () => {
  const { createClickCounter } = require('../src/clicks');
  await create({ url: 'https://example.com/stop', slug: 'stop-1' });
  const counter = createClickCounter(pool, { intervalMs: 60000 });
  counter.record('stop-1');
  counter.record('stop-1');
  counter.record('stop-1');
  await counter.stop();
  expect(await clicksOf('stop-1')).toBe(3);
});
