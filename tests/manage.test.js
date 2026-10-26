const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

const H = { 'X-Requested-With': 'test' };
let pool, app, A, B;
const future = (ms = 3600e3) => new Date(Date.now() + ms).toISOString();

async function login(email) {
  const ag = request.agent(app);
  await ag.post('/api/auth/register').set(H).send({ email, password: 'password123' }).expect(201);
  return ag;
}
const mk = (ag, body) => ag.post('/api/links').set(H).send(body);

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool });
  A = await login('a@example.com');
  B = await login('b@example.com');
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await pool.end();
});

describe('create with options', () => {
  test('title/note/expiresAt/maxClicks are stored and validated', async () => {
    const exp = future();
    const r = await mk(A, { url: 'https://example.com/x', slug: 'opt-1', title: 'T', note: 'N', expiresAt: exp, maxClicks: 5 }).expect(201);
    expect(r.body).toMatchObject({ title: 'T', note: 'N', maxClicks: 5, isActive: true });
    expect(new Date(r.body.expiresAt).toISOString()).toBe(exp);
    await mk(A, { url: 'https://example.com/x', title: 'x'.repeat(101) }).expect(400).expect({ error: 'INVALID_TITLE' });
    await mk(A, { url: 'https://example.com/x', note: 5 }).expect(400).expect({ error: 'INVALID_NOTE' });
    await mk(A, { url: 'https://example.com/x', expiresAt: 'garbage' }).expect(400).expect({ error: 'INVALID_EXPIRES' });
    await mk(A, { url: 'https://example.com/x', expiresAt: '2000-01-01T00:00:00Z' }).expect(400).expect({ error: 'INVALID_EXPIRES' });
    await mk(A, { url: 'https://example.com/x', maxClicks: 0 }).expect(400).expect({ error: 'INVALID_MAX_CLICKS' });
    await mk(A, { url: 'https://example.com/x', maxClicks: '3' }).expect(400).expect({ error: 'INVALID_MAX_CLICKS' });
  });
});

describe('PATCH / DELETE ownership', () => {
  test('owner can patch; slug unchanged; url validated', async () => {
    await mk(A, { url: 'https://example.com/old', slug: 'patch-1' }).expect(201);
    const r = await A.patch('/api/links/patch-1').set(H).send({ url: 'https://example.com/new', title: 'Hi', note: 'n', maxClicks: 10, slug: 'other' }).expect(200);
    expect(r.body).toMatchObject({ slug: 'patch-1', url: 'https://example.com/new', title: 'Hi', note: 'n', maxClicks: 10 });
    await A.patch('/api/links/patch-1').set(H).send({ url: 'ftp://x.com' }).expect(400).expect({ error: 'INVALID_URL' });
    await A.patch('/api/links/patch-1').set(H).send({}).expect(400);
    await A.patch('/api/links/patch-1').set(H).send({ isActive: 'no' }).expect(400);
    await A.patch('/api/links/patch-1').set(H).send({ title: null, maxClicks: null }).expect(200);
  });

  test('user B PATCH/DELETE A link -> 404 and data unchanged', async () => {
    await mk(A, { url: 'https://example.com/mine', slug: 'owned-1', title: 'keep' }).expect(201);
    await B.patch('/api/links/owned-1').set(H).send({ url: 'https://evil.com', title: 'hacked', isActive: false }).expect(404);
    await B.delete('/api/links/owned-1').set(H).expect(404);
    const row = (await pool.query("SELECT target_url, title, is_active FROM links WHERE slug = 'owned-1'")).rows[0];
    expect(row).toEqual({ target_url: 'https://example.com/mine', title: 'keep', is_active: true });
    await request(app).get('/owned-1').expect(302);
  });

  test('unauthenticated -> 401; unknown slug -> 404', async () => {
    await request(app).patch('/api/links/owned-1').set(H).send({ title: 'x' }).expect(401);
    await request(app).delete('/api/links/owned-1').set(H).expect(401);
    await A.patch('/api/links/nope-nope').set(H).send({ title: 'x' }).expect(404);
    await A.delete('/api/links/nope-nope').set(H).expect(404);
  });

  test('guest link (no owner) cannot be patched/deleted', async () => {
    await request(app).post('/api/links').set(H).send({ url: 'https://example.com/g', slug: 'guest-1' }).expect(201);
    await A.patch('/api/links/guest-1').set(H).send({ title: 'x' }).expect(404);
    await A.delete('/api/links/guest-1').set(H).expect(404);
  });

  test('DELETE removes link and LRU cache entry', async () => {
    await mk(A, { url: 'https://example.com/del', slug: 'del-1' }).expect(201);
    await request(app).get('/del-1').expect(302);
    expect(app.locals.cache.get('del-1')).toBeDefined();
    await A.delete('/api/links/del-1').set(H).expect(204);
    expect(app.locals.cache.get('del-1')).toBeUndefined();
    await request(app).get('/del-1').expect(404);
  });

  test('PATCH url updates cache (redirect goes to new url); disable -> 410', async () => {
    await mk(A, { url: 'https://example.com/v1', slug: 'cache-1' }).expect(201);
    expect((await request(app).get('/cache-1')).headers.location).toBe('https://example.com/v1');
    await A.patch('/api/links/cache-1').set(H).send({ url: 'https://example.com/v2' }).expect(200);
    expect((await request(app).get('/cache-1')).headers.location).toBe('https://example.com/v2');
    await A.patch('/api/links/cache-1').set(H).send({ isActive: false }).expect(200);
    await request(app).get('/cache-1').expect(410);
    await A.patch('/api/links/cache-1').set(H).send({ isActive: true }).expect(200);
    await request(app).get('/cache-1').expect(302);
  });
});

describe('410 behaviour', () => {
  test('disabled link -> 410 html (i18n) / json, no click counted', async () => {
    await mk(A, { url: 'https://example.com/d', slug: 'off-1' }).expect(201);
    await A.patch('/api/links/off-1').set(H).send({ isActive: false }).expect(200);
    const vi = await request(app).get('/off-1').set('Accept', 'text/html').set('Accept-Language', 'vi').expect(410);
    expect(vi.text).toContain('Link này đã bị tắt');
    const en = await request(app).get('/off-1').set('Accept', 'text/html').set('Accept-Language', 'en').expect(410);
    expect(en.text).toContain('disabled, expired');
    const js = await request(app).get('/off-1').set('Accept', 'application/json').expect(410);
    expect(js.body).toEqual({ error: 'GONE' });
    expect(js.headers.location).toBeUndefined();
    await app.locals.clicks.flush();
    expect((await pool.query("SELECT clicks FROM links WHERE slug='off-1'")).rows[0].clicks).toBe(0);
  });

  test('expired link -> 410, including when already cached', async () => {
    await mk(A, { url: 'https://example.com/e', slug: 'exp-1', expiresAt: future() }).expect(201);
    await request(app).get('/exp-1').expect(302);
    await pool.query("UPDATE links SET expires_at = now() - interval '1 minute' WHERE slug = 'exp-1'");
    // cache còn giữ expiresAt cũ (tương lai) -> chỉnh entry giả lập thời gian trôi qua
    const entry = app.locals.cache.get('exp-1');
    app.locals.cache.set('exp-1', { ...entry, expiresAt: Date.now() - 1000 });
    await request(app).get('/exp-1').expect(410);
    await request(app).get('/exp-1').expect(410); // cache đã xoá, đọc DB
    await app.locals.clicks.flush();
    expect(Number((await pool.query("SELECT clicks FROM links WHERE slug='exp-1'")).rows[0].clicks)).toBe(1);
  });

  test('max_clicks reached -> 410', async () => {
    await mk(A, { url: 'https://example.com/m', slug: 'max-1', maxClicks: 2 }).expect(201);
    await request(app).get('/max-1').expect(302);
    await request(app).get('/max-1').expect(302);
    await request(app).get('/max-1').expect(410);
    await app.locals.clicks.flush();
    expect(Number((await pool.query("SELECT clicks FROM links WHERE slug='max-1'")).rows[0].clicks)).toBe(2);
  });
});

describe('list search / filter', () => {
  beforeAll(async () => {
    const C = await login('c@example.com');
    await mk(C, { url: 'https://alpha.example.org/p', slug: 'srch-alpha', title: 'First' }).expect(201);
    await mk(C, { url: 'https://beta.example.org/50%_off', slug: 'srch-beta', title: 'Second' }).expect(201);
    await mk(C, { url: 'https://gamma.example.org/q', slug: 'srch-gamma', title: 'Zebra' }).expect(201);
    await mk(C, { url: 'https://delta.example.org/q', slug: 'srch-delta' }).expect(201);
    await C.patch('/api/links/srch-gamma').set(H).send({ isActive: false }).expect(200);
    await pool.query("UPDATE links SET expires_at = now() - interval '1 hour' WHERE slug = 'srch-delta'");
    C.__ = true;
    global.__C = C;
  });
  const slugsOf = async (qs) => (await global.__C.get(`/api/links${qs}`).expect(200)).body.items.map((i) => i.slug).sort();

  test('q matches slug / url / title case-insensitively', async () => {
    expect(await slugsOf('?q=ALPHA')).toEqual(['srch-alpha']);
    expect(await slugsOf('?q=beta.example')).toEqual(['srch-beta']);
    expect(await slugsOf('?q=zebra')).toEqual(['srch-gamma']);
  });

  test('SQL wildcards in q are escaped (not treated as wildcards)', async () => {
    // pg-mem không hiểu escape của LIKE nên kiểm tra tham số gửi xuống DB đã escape,
    // và "%" / "_" không khớp mọi link như một wildcard.
    const spy = jest.spyOn(pool, 'query');
    const all = await slugsOf('');
    expect(all).toHaveLength(4);
    expect(await slugsOf('?q=%25')).not.toEqual(all);
    expect(await slugsOf('?q=_')).not.toEqual(all);
    expect(await slugsOf('?q=%25_%25')).toEqual([]);
    const likeParams = spy.mock.calls.filter(([sql]) => /ILIKE/.test(sql)).map(([, p]) => p[1]);
    spy.mockRestore();
    expect(likeParams).toEqual(expect.arrayContaining(['%\\%%', '%\\_%', '%\\%\\_\\%%']));
  });

  test('injection-like q is just text', async () => {
    expect(await slugsOf(`?q=${encodeURIComponent("' OR 1=1 --")}`)).toEqual([]);
  });

  test('status filter and pagination', async () => {
    expect(await slugsOf('?status=active')).toEqual(['srch-alpha', 'srch-beta']);
    expect(await slugsOf('?status=disabled')).toEqual(['srch-gamma']);
    expect(await slugsOf('?status=expired')).toEqual(['srch-delta']);
    await global.__C.get('/api/links?status=bogus').expect(400);
    const p = (await global.__C.get('/api/links?q=srch&pageSize=2&page=2').expect(200)).body;
    expect(p).toMatchObject({ total: 4, totalPages: 2, page: 2 });
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toHaveProperty('status');
  });
});

describe('preview', () => {
  test('shows escaped destination and continue link', async () => {
    const url = 'https://example.com/a?x=<script>alert(1)</script>&y="z"';
    await mk(A, { url, slug: 'prev-1' }).expect(201);
    const r = await request(app).get('/preview/prev-1').set('Accept', 'text/html').set('Accept-Language', 'vi').expect(200);
    expect(r.text).not.toContain('<script>');
    expect(r.text).toContain('&amp;y=');
    expect(r.text).not.toMatch(/&y=/);
    expect(r.text).toContain('Tiếp tục');
    expect(r.text).toContain('href="/prev-1"');
    const en = await request(app).get('/preview/prev-1').set('Accept-Language', 'en').set('Accept', 'text/html');
    expect(en.text).toContain('Continue');
    await app.locals.clicks.flush();
    expect(Number((await pool.query("SELECT clicks FROM links WHERE slug='prev-1'")).rows[0].clicks)).toBe(0);
  });

  test('missing -> 404, disabled/expired -> 410', async () => {
    await request(app).get('/preview/nothere1').expect(404);
    await request(app).get('/preview/ab').expect(404);
    await mk(A, { url: 'https://example.com/p', slug: 'prev-2' }).expect(201);
    await A.patch('/api/links/prev-2').set(H).send({ isActive: false }).expect(200);
    await request(app).get('/preview/prev-2').expect(410);
  });
});

describe('self reference', () => {
  test('Host header and BASE_URL are blocked on create and patch', async () => {
    await request(app).post('/api/links').set(H).set('Host', 'sho.rt').send({ url: 'https://sho.rt/abc' }).expect(400).expect({ error: 'SELF_REFERENCE' });
    await request(app).post('/api/links').set(H).set('Host', 'sho.rt').send({ url: 'https://SHO.rt/abc' }).expect(400);
    await request(app).post('/api/links').set(H).set('Host', 'sho.rt').send({ url: 'https://other.rt/abc' }).expect(201);
    process.env.BASE_URL = 'https://short.example.net';
    try {
      await mk(A, { url: 'https://short.example.net/zzz' }).expect(400).expect({ error: 'SELF_REFERENCE' });
      await mk(A, { url: 'https://example.com/ok', slug: 'self-1' }).expect(201);
      await A.patch('/api/links/self-1').set(H).send({ url: 'http://short.example.net/loop' }).expect(400).expect({ error: 'SELF_REFERENCE' });
    } finally {
      delete process.env.BASE_URL;
    }
    expect((await pool.query("SELECT target_url FROM links WHERE slug='self-1'")).rows[0].target_url).toBe('https://example.com/ok');
  });
});

test('renderPreview escapes HTML in url', () => {
  const { renderPreview } = require('../src/pages');
  const html = renderPreview('en', 'abc', 'https://x.com/<img src=x onerror=alert(1)>"&');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
  expect(html).toContain('&quot;&amp;');
});

test('every new i18n key exists in vi and en', () => {
  const vi = require('../public/locales/vi.json');
  const en = require('../public/locales/en.json');
  for (const k of ['gone.title', 'gone.body', 'preview.continue', 'error.SELF_REFERENCE', 'error.INVALID_EXPIRES', 'error.INVALID_MAX_CLICKS', 'error.INVALID_TITLE', 'error.INVALID_NOTE', 'error.GONE', 'error.INVALID_STATUS', 'error.INVALID_QUERY']) {
    expect(vi[k]).toBeTruthy();
    expect(en[k]).toBeTruthy();
  }
  expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
});
