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

async function login(email, password = 'password123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send(creds(email, password)).expect(201);
  return agent;
}

test('register sets HttpOnly SameSite=Lax cookie, me works, logout invalidates', async () => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(creds('  Alice@Example.com '));
  expect(res.status).toBe(201);
  expect(res.body.user.email).toBe('alice@example.com');
  const cookie = res.headers['set-cookie'][0];
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect((await agent.get('/api/auth/me')).body.user.email).toBe('alice@example.com');
  await agent.post('/api/auth/logout').set(XR).expect(200);
  expect((await agent.get('/api/auth/me')).status).toBe(401);
  const l = await request(app).post('/api/auth/login').send(creds('ALICE@example.com'));
  expect(l.status).toBe(200);
});

test('Secure cookie in production', async () => {
  process.env.NODE_ENV = 'production';
  try {
    const r = await request(app).post('/api/auth/register').send(creds('prod@example.com'));
    expect(r.headers['set-cookie'][0]).toMatch(/Secure/i);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('duplicate email -> 409, invalid email / short password -> 400', async () => {
  await login('dup@example.com');
  const d = await request(app).post('/api/auth/register').send(creds('DUP@example.com'));
  expect(d.status).toBe(409);
  expect(d.body.error).toBe('EMAIL_TAKEN');
  expect((await request(app).post('/api/auth/register').send(creds('nope'))).body.error).toBe('INVALID_EMAIL');
  const w = await request(app).post('/api/auth/register').send(creds('short@example.com', '1234567'));
  expect([w.status, w.body.error]).toEqual([400, 'WEAK_PASSWORD']);
});

test('wrong password / unknown email -> 401 same error', async () => {
  await login('wp@example.com');
  const a = await request(app).post('/api/auth/login').send(creds('wp@example.com', 'wrongwrong'));
  const b = await request(app).post('/api/auth/login').send(creds('ghost@example.com'));
  expect([a.status, b.status]).toEqual([401, 401]);
  expect(a.body).toEqual(b.body);
});

test('password stored hashed, not raw', async () => {
  await login('hash@example.com', 'SuperSecret999');
  const r = await pool.query("SELECT password_hash FROM users WHERE email = 'hash@example.com'");
  expect(r.rows[0].password_hash).toMatch(/^scrypt\$/);
  expect(r.rows[0].password_hash).not.toContain('SuperSecret999');
  const s = await pool.query('SELECT id FROM sessions');
  expect(s.rows.every((x) => x.id.length === 64)).toBe(true);
});

test('login rate-limit: 5 failures -> 429, even with right password; other email unaffected', async () => {
  await login('rl@example.com');
  for (let i = 0; i < 5; i++) {
    expect((await request(app).post('/api/auth/login').send(creds('rl@example.com', 'badbadbad'))).status).toBe(401);
  }
  const blocked = await request(app).post('/api/auth/login').send(creds('rl@example.com'));
  expect([blocked.status, blocked.body.error]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
  expect((await request(app).post('/api/auth/login').send(creds('wp@example.com'))).status).toBe(200);
});

test('guest link creation rate-limit per IP (configurable)', async () => {
  const small = createApp({ pool, guestLinkLimit: 2 });
  const post = () => request(small).post('/api/links').send({ url: 'https://example.com/g' });
  expect((await post()).status).toBe(201);
  expect((await post()).status).toBe(201);
  const r = await post();
  expect([r.status, r.body.error]).toEqual([429, 'RATE_LIMITED']);
  // user đăng nhập không bị giới hạn khách
  const agent = request.agent(small);
  await agent.post('/api/auth/register').send(creds('limit@example.com')).expect(201);
  await agent.post('/api/links').set(XR).send({ url: 'https://example.com/u' }).expect(201);
  await small.locals.clicks.stop();
});

test('B1: user A does not see user B links; guest list -> 401; link gets user_id', async () => {
  const a = await login('a@example.com');
  const b = await login('b@example.com');
  await a.post('/api/links').set(XR).send({ url: 'https://example.com/a', slug: 'a-link' }).expect(201);
  await b.post('/api/links').set(XR).send({ url: 'https://example.com/b', slug: 'b-link' }).expect(201);
  await request(app).post('/api/links').send({ url: 'https://example.com/guest', slug: 'guest-link' }).expect(201);
  const la = (await a.get('/api/links')).body;
  expect(la.items.map((i) => i.slug)).toEqual(['a-link']);
  expect(la.total).toBe(1);
  expect((await b.get('/api/links')).body.items.map((i) => i.slug)).toEqual(['b-link']);
  const g = await request(app).get('/api/links');
  expect([g.status, g.body.error]).toEqual([401, 'UNAUTHORIZED']);
  const row = await pool.query("SELECT user_id FROM links WHERE slug IN ('guest-link')");
  expect(row.rows[0].user_id).toBeNull();
  await request(app).get('/a-link').expect(302); // redirect vẫn công khai
});

test('CSRF: cookie + mutating request without header/Origin -> 403; Origin matching host ok', async () => {
  const agent = await login('csrf@example.com');
  const bad = await agent.post('/api/links').send({ url: 'https://example.com/c' });
  expect([bad.status, bad.body.error]).toEqual([403, 'CSRF']);
  await agent.post('/api/links').set('Origin', 'https://evil.example').set('Host', 'sho.rt').send({ url: 'https://example.com/c' }).expect(403);
  await agent.post('/api/links').set('Origin', 'http://sho.rt').set('Host', 'sho.rt').send({ url: 'https://example.com/c' }).expect(201);
  await agent.post('/api/auth/logout').expect(403);
  await agent.post('/api/auth/logout').set(XR).expect(200);
});

test('change password', async () => {
  const agent = await login('cp@example.com', 'oldpassword1');
  const other = request.agent(app);
  await other.post('/api/auth/login').send(creds('cp@example.com', 'oldpassword1')).expect(200);
  const bad = await agent.post('/api/auth/change-password').set(XR).send({ currentPassword: 'nope-nope', newPassword: 'newpassword1' });
  expect(bad.status).toBe(401);
  const weak = await agent.post('/api/auth/change-password').set(XR).send({ currentPassword: 'oldpassword1', newPassword: 'short' });
  expect(weak.status).toBe(400);
  await agent.post('/api/auth/change-password').set(XR).send({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' }).expect(200);
  expect((await agent.get('/api/auth/me')).status).toBe(200);
  expect((await other.get('/api/auth/me')).status).toBe(401);
  expect((await request(app).post('/api/auth/login').send(creds('cp@example.com', 'oldpassword1'))).status).toBe(401);
  expect((await request(app).post('/api/auth/login').send(creds('cp@example.com', 'newpassword1'))).status).toBe(200);
  expect((await request(app).post('/api/auth/change-password').set(XR).send({})).status).toBe(401);
});

test('reserved slugs and auth pages', async () => {
  for (const s of ['login', 'register', 'logout', 'me', 'profile', 'preview']) {
    const r = await request(app).post('/api/links').send({ url: 'https://example.com', slug: s });
    expect([s, r.status, r.body.error]).toEqual([s, 400, s === 'me' ? 'INVALID_SLUG' : 'RESERVED_SLUG']); // 'me' < 3 ký tự nên đã bị SLUG_RE chặn
  }
  for (const p of ['/login', '/register']) expect((await request(app).get(p)).status).toBe(200);
});
