const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

let pool, app;
const XR = { 'X-Requested-With': 'test' };
const creds = (email, password = 'password123') => ({ email, password });

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

async function reg(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send(creds(email)).expect(201);
  return agent;
}

test('E2E B1: A creates, A sees own, B sees none, B cannot mutate A link', async () => {
  const a = await reg('ea@example.com');
  const b = await reg('eb@example.com');
  const c = await a.post('/api/links').set(XR).send({ url: 'https://example.org/a' }).expect(201);
  const slug = c.body.slug;
  expect((await a.get('/api/links')).body.items.map((i) => i.slug)).toEqual([slug]);
  expect((await b.get('/api/links')).body.total).toBe(0);
  for (const m of ['put', 'patch', 'delete']) {
    const r = await b[m](`/api/links/${slug}`).set(XR).send({ url: 'https://evil.example' });
    expect([403, 404, 405]).toContain(r.status);
  }
  const row = (await pool.query('SELECT target_url, user_id FROM links WHERE slug=$1', [slug])).rows[0];
  expect(row.target_url).toBe('https://example.org/a');
});

test('password not raw in DB; session token stored hashed', async () => {
  const a = await reg('hash@example.com');
  const u = (await pool.query("SELECT password_hash FROM users WHERE email='hash@example.com'")).rows[0];
  expect(u.password_hash).not.toContain('password123');
  const r = await request(app).post('/api/auth/login').send(creds('hash@example.com'));
  const token = /sid=([0-9a-f]+)/.exec(r.headers['set-cookie'][0])[1];
  const rows = (await pool.query('SELECT id FROM sessions')).rows.map((x) => x.id);
  expect(rows).not.toContain(token);
});

test('forged / garbage / SQL-ish cookies are anonymous', async () => {
  for (const c of ['sid=' + 'a'.repeat(64), "sid=' OR 1=1 --", 'sid=', 'sid=../../etc']) {
    const r = await request(app).get('/api/auth/me').set('Cookie', c);
    expect(r.status).toBe(401);
  }
});

test('logout then replaying old cookie fails', async () => {
  const r = await request(app).post('/api/auth/login').send(creds('ea@example.com'));
  const ck = r.headers['set-cookie'][0].split(';')[0];
  expect((await request(app).get('/api/auth/me').set('Cookie', ck)).status).toBe(200);
  await request(app).post('/api/auth/logout').set('Cookie', ck).set(XR).expect(200);
  expect((await request(app).get('/api/auth/me').set('Cookie', ck)).status).toBe(401);
});

test('expired session rejected', async () => {
  const r = await request(app).post('/api/auth/login').send(creds('ea@example.com'));
  const ck = r.headers['set-cookie'][0].split(';')[0];
  await pool.query('UPDATE sessions SET expires_at = $1', [new Date(Date.now() - 1000)]);
  expect((await request(app).get('/api/auth/me').set('Cookie', ck)).status).toBe(401);
});

test('CSRF: cross-origin / null / malformed Origin rejected, same-origin ok', async () => {
  const r = await request(app).post('/api/auth/register').send(creds('csrf@example.com'));
  const ck = r.headers['set-cookie'][0].split(';')[0];
  const post = (origin) => {
    const q = request(app).post('/api/links').set('Cookie', ck).send({ url: 'https://example.org/x' });
    return origin === undefined ? q : q.set('Origin', origin);
  };
  expect((await post()).status).toBe(403);
  expect((await post('https://evil.example')).status).toBe(403);
  expect((await post('null')).status).toBe(403);
  expect((await post('not a url')).status).toBe(403);
  const host = request(app).get('/healthz');
  expect((await post('http://127.0.0.1')).status).toBe(403); // host is 127.0.0.1:port
  const res = await request(app).post('/api/auth/logout').set('Cookie', ck);
  expect(res.status).toBe(403);
  // session still alive after rejected logout
  expect((await request(app).get('/api/auth/me').set('Cookie', ck)).status).toBe(200);
  await host;
});

test('guest can still create links; guest link has no owner', async () => {
  const r = await request(app).post('/api/links').send({ url: 'https://example.org/g' });
  expect(r.status).toBe(201);
  const row = (await pool.query('SELECT user_id FROM links WHERE slug=$1', [r.body.slug])).rows[0];
  expect(row.user_id).toBeNull();
});

test('change-password invalidates other sessions; old password stops working', async () => {
  const s1 = await request(app).post('/api/auth/register').send(creds('cp@example.com'));
  const ck1 = s1.headers['set-cookie'][0].split(';')[0];
  const s2 = await request(app).post('/api/auth/login').send(creds('cp@example.com'));
  const ck2 = s2.headers['set-cookie'][0].split(';')[0];
  await request(app).post('/api/auth/change-password').set('Cookie', ck1).set(XR)
    .send({ currentPassword: 'password123', newPassword: 'newpassword456' }).expect(200);
  expect((await request(app).get('/api/auth/me').set('Cookie', ck2)).status).toBe(401);
  expect((await request(app).post('/api/auth/login').send(creds('cp@example.com'))).status).toBe(401);
  expect((await request(app).post('/api/auth/login').send(creds('cp@example.com', 'newpassword456'))).status).toBe(200);
});

test('non-string / malformed auth bodies do not 500', async () => {
  for (const b of [{}, { email: 1, password: 2 }, { email: [], password: {} }, { email: 'a@b.co', password: null }]) {
    expect((await request(app).post('/api/auth/login').send(b)).status).toBe(401);
    expect((await request(app).post('/api/auth/register').send(b)).status).toBe(400);
  }
});

describe('rate limit hardening', () => {
  const { createApp: mk } = require('../src/app');
  test('parallel wrong logins: most get 429', async () => {
    const a = mk({ pool });
    await request(a).post('/api/auth/register').send(creds('par@example.com')).expect(201);
    const rs = await Promise.all(Array.from({ length: 30 }, () =>
      request(a).post('/api/auth/login').send(creds('par@example.com', 'wrongpass99'))));
    const n429 = rs.filter((r) => r.status === 429).length;
    expect(rs.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(n429).toBeGreaterThanOrEqual(25);
    await a.locals.clicks.stop();
  });
  test('register limited per IP', async () => {
    process.env.REGISTER_PER_HOUR = '10';
    const a = mk({ pool });
    process.env.REGISTER_PER_HOUR = '100000';
    const codes = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await request(a).post('/api/auth/register').send(creds(`rl${i}@example.com`))).status);
    }
    expect(codes.filter((c) => c === 429).length).toBe(2);
    await a.locals.clicks.stop();
  });
  test("another user's link is 404 on GET /api/links/:slug but redirect is public", async () => {
    const owner = await reg('own1@example.com');
    const c = await owner.post('/api/links').set(XR).send({ url: 'https://example.com/x' }).expect(201);
    await owner.get(`/api/links/${c.body.slug}`).expect(200);
    await request(app).get(`/api/links/${c.body.slug}`).expect(404);
    const other = await reg('oth1@example.com');
    await other.get(`/api/links/${c.body.slug}`).expect(404);
    await request(app).get(`/${c.body.slug}`).expect(302);
  });
  test('login purges expired sessions', async () => {
    await request(app).post('/api/auth/register').send(creds('purge@example.com')).expect(201);
    const uid = (await pool.query("SELECT id FROM users WHERE email = 'purge@example.com'")).rows[0].id;
    await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', ['dead1', uid, new Date(Date.now() - 1000)]);
    await request(app).post('/api/auth/login').send(creds('purge@example.com')).expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect((await pool.query("SELECT 1 FROM sessions WHERE id = 'dead1'")).rows.length).toBe(0);
  });
});
