const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

let pool, app, agent;
const slugs = [];

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool });
  agent = request.agent(app);
  await agent.post('/api/auth/register').set('X-Requested-With', 'test').send({ email: 'list@example.com', password: 'password123' }).expect(201);
  for (let i = 0; i < 45; i++) {
    const r = await agent.set('X-Requested-With', 'test').post('/api/links').send({ url: `https://example.com/${i}`, slug: `link-${String(i).padStart(2, '0')}` });
    slugs.push(r.body.slug);
  }
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await pool.end();
});

// T7: dashboard chỉ trả link của user đăng nhập nên dùng agent có cookie phiên.
const list = (q = '') => agent.get(`/api/links${q}`);

test('pagination 45 links: 20/20/5', async () => {
  const p1 = (await list('?page=1&pageSize=20')).body;
  expect(p1.items).toHaveLength(20);
  expect(p1).toMatchObject({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
  expect((await list('?page=2')).body.items).toHaveLength(20);
  expect((await list('?page=3')).body.items).toHaveLength(5);
  expect(p1.items[0]).toEqual(expect.objectContaining({ slug: expect.any(String), url: expect.any(String), shortUrl: expect.stringContaining(p1.items[0].slug), clicks: 0 }));
});

test('newest first, stable across pages', async () => {
  const all = [];
  for (const p of [1, 2, 3]) all.push(...(await list(`?page=${p}`)).body.items.map((i) => i.slug));
  expect(all).toEqual([...slugs].reverse());
});

test('clicks accurate after redirects', async () => {
  for (let i = 0; i < 3; i++) await request(app).get('/link-10').expect(302);
  const items = (await list('?pageSize=100')).body.items;
  expect(items.find((i) => i.slug === 'link-10').clicks).toBe(3);
});

test('pageSize bounds', async () => {
  const ok = await list('?pageSize=100');
  expect(ok.status).toBe(200);
  expect(ok.body.items).toHaveLength(45);
  expect(ok.body.totalPages).toBe(1);
  expect((await list('?pageSize=101')).status).toBe(400);
});

test.each(['?page=0', '?page=abc', '?pageSize=-1', '?pageSize=0', '?page=1.5'])('invalid %s -> 400', async (q) => {
  const res = await list(q);
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'INVALID_PAGINATION' });
});

test('page beyond range -> empty items', async () => {
  const res = await list('?page=99');
  expect(res.status).toBe(200);
  expect(res.body.items).toEqual([]);
  expect(res.body.total).toBe(45);
});
