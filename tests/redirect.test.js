const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');
const { LruCache } = require('../src/cache');

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

test('A1: create then GET /slug -> 302 to target', async () => {
  const link = await create({ url: 'https://example.com/a?b=1' });
  expect(link.slug).toHaveLength(7);
  const res = await request(app).get(`/${link.slug}`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://example.com/a?b=1');
});

test('A4: 7 redirects -> clicks = 7 via API', async () => {
  const link = await create({ url: 'https://example.com/c', slug: 'count-me' });
  for (let i = 0; i < 7; i++) await request(app).get('/count-me').expect(302);
  await app.locals.clicks.flush();
  const res = await request(app).get('/api/links/count-me');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ slug: link.slug, url: 'https://example.com/c', clicks: 7 });
  expect(res.body.createdAt).toBeDefined();
});

test('GET /api/links/:slug unknown -> 404 NOT_FOUND', async () => {
  const res = await request(app).get('/api/links/nope-nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'NOT_FOUND' });
});

test('A5: unknown slug -> 404 html, or json when Accept json', async () => {
  const html = await request(app).get('/missing1').set('Accept', 'text/html');
  expect(html.status).toBe(404);
  expect(html.headers['content-type']).toMatch(/html/);
  const json = await request(app).get('/missing1').set('Accept', 'application/json');
  expect(json.status).toBe(404);
  expect(json.body).toEqual({ error: 'NOT_FOUND' });
});

test('invalid slug regex -> 404 without touching DB', async () => {
  const spy = jest.spyOn(pool, 'query');
  for (const s of ['ab', 'a'.repeat(33), 'bad.slug', 'x%20y']) {
    await request(app).get(`/${s}`).expect(404);
  }
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

test('cache hit does not SELECT from DB', async () => {
  await create({ url: 'https://example.com/cache', slug: 'cached1' });
  await request(app).get('/cached1').expect(302);
  const spy = jest.spyOn(pool, 'query');
  const res = await request(app).get('/cached1');
  expect(res.status).toBe(302);
  expect(spy.mock.calls.filter(([sql]) => /select/i.test(sql))).toHaveLength(0);
  spy.mockRestore();
});

test('/healthz and /api are not swallowed by slug route', async () => {
  const h = await request(app).get('/healthz');
  expect(h.status).toBe(200);
  expect(h.body).toEqual({ ok: true });
  const a = await request(app).get('/api/links/zzzzzzz');
  expect(a.body).toEqual({ error: 'NOT_FOUND' });
});

test('LRU evicts least recently used', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  expect(c.get('b')).toBeUndefined();
  expect(c.get('a')).toBe(1);
  expect(c.size).toBe(2);
});

test('A6: p95 of 200 sequential cached redirects < 50ms', async () => {
  await create({ url: 'https://example.com/perf', slug: 'perf-1' });
  await request(app).get('/perf-1').expect(302); // warm cache
  const times = [];
  for (let i = 0; i < 200; i++) {
    const t = process.hrtime.bigint();
    await request(app).get('/perf-1').expect(302);
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  times.sort((x, y) => x - y);
  const p95 = times[Math.floor(times.length * 0.95) - 1];
  console.log(`A6 p95 = ${p95.toFixed(2)} ms`);
  expect(p95).toBeLessThan(50);
});
