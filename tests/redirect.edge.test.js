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

// Malformed percent-encoding: Express throws URIError (status 400) -> must answer 400.
test('malformed percent-encoding /%E0%A4%A -> 400, not 500', async () => {
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

test('HEAD and prefetch requests do not count clicks (still 302)', async () => {
  await create({ url: 'https://example.com/nocount', slug: 'nocount-1' });
  await request(app).head('/nocount-1').expect(302);
  await request(app).get('/nocount-1').set('Purpose', 'prefetch').expect(302);
  await request(app).get('/nocount-1').set('Sec-Purpose', 'prefetch').expect(302);
  await app.locals.clicks.flush();
  expect(await clicksOf('nocount-1')).toBe(0);
  await request(app).get('/nocount-1').expect(302);
  await app.locals.clicks.flush();
  expect(await clicksOf('nocount-1')).toBe(1);
});

test('failed flush keeps clicks; next successful flush writes them all', async () => {
  const { createClickCounter } = require('../src/clicks');
  await create({ url: 'https://example.com/fail', slug: 'fail-1' });
  const counter = createClickCounter(pool, { intervalMs: 60000 });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const qSpy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
  counter.record('fail-1');
  counter.record('fail-1');
  await counter.flush();
  expect(errSpy).toHaveBeenCalled();
  qSpy.mockRestore();
  errSpy.mockRestore();
  expect(await clicksOf('fail-1')).toBe(0);
  counter.record('fail-1');
  await counter.stop();
  expect(await clicksOf('fail-1')).toBe(3);
});

test('batch is dropped after 5 consecutive failures', async () => {
  const { createClickCounter } = require('../src/clicks');
  await create({ url: 'https://example.com/drop', slug: 'drop-1' });
  const counter = createClickCounter(pool, { intervalMs: 60000 });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const qSpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('db down'));
  counter.record('drop-1');
  for (let i = 0; i < 5; i++) await counter.flush();
  qSpy.mockRestore();
  errSpy.mockRestore();
  await counter.stop();
  expect(await clicksOf('drop-1')).toBe(0);
});

test('concurrent flush calls are coalesced and still exact', async () => {
  await create({ url: 'https://example.com/co', slug: 'coal-1' });
  await Promise.all(Array.from({ length: 10 }, () => request(app).get('/coal-1').expect(302)));
  await Promise.all(Array.from({ length: 5 }, () => request(app).get('/api/links/coal-1')));
  const res = await request(app).get('/api/links/coal-1').expect(200);
  expect(res.body.clicks).toBe(10);
});
